'use strict';

const express = require('express');
const { normalizeSharelinkUrl, TOSS_SOURCES } = require('./toss-sharelink');

const DEFAULT_CLOCK = () => new Date();
const PRODUCT_ID_PATTERN = /^[1-9]\d{0,30}$/;
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function currentDate(clock) {
  const date = new Date(clock());
  if (Number.isNaN(date.getTime())) throw new TypeError('clock must return a valid date');
  return date;
}

function strictIsoTimestamp(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== 'string') return null;
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!daysInMonth || day < 1 || day > daysInMonth
    || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59
    || (offsetHourText != null && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59))) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeProductId(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Toss product ID is invalid');
    return String(value);
  }
  if (typeof value !== 'string' || !PRODUCT_ID_PATTERN.test(value)) {
    throw new TypeError('Toss product ID is invalid');
  }
  return value;
}

function toPublicRecommendation(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  try {
    const productId = normalizeProductId(item.productId);
    if (!TOSS_SOURCES.includes(item.source)) throw new TypeError('Toss source is invalid');
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title || title.length > 500) throw new TypeError('Toss title is invalid');
    if (item.priceAmount !== null
      && (!Number.isSafeInteger(item.priceAmount) || item.priceAmount < 0)) {
      throw new TypeError('Toss price is invalid');
    }
    if (!Number.isSafeInteger(item.rank) || item.rank < 1 || item.rank > 10) {
      throw new TypeError('Toss rank is invalid');
    }
    const endAt = item.endAt === null ? null : strictIsoTimestamp(item.endAt);
    if (item.endAt !== null && endAt == null) throw new TypeError('Toss endAt is invalid');
    return {
      productId,
      source: item.source,
      title,
      price: item.priceAmount ?? null,
      sharelinkUrl: normalizeSharelinkUrl(item.sharelinkUrl),
      rank: item.rank,
      endAt,
    };
  } catch {
    return null;
  }
}

function cacheSeconds(items, now) {
  let seconds = 60;
  for (const item of items) {
    if (item.endAt == null) continue;
    const endTime = Date.parse(item.endAt);
    seconds = Math.min(seconds, Math.max(0, Math.floor((endTime - now.getTime()) / 1000)));
  }
  return seconds;
}

function createTossRecommendationsRouter({ runtime, store, clock = DEFAULT_CLOCK } = {}) {
  const router = express.Router();
  if (typeof clock !== 'function') throw new TypeError('clock is required');

  router.get('/', async (req, res) => {
    if (Object.keys(req.query).length > 0) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(400).json({
        code: 'INVALID_QUERY',
        message: '토스쇼핑 추천 API는 검색, 정렬, 필터, 페이지 쿼리를 지원하지 않습니다.',
      });
    }
    if (!runtime?.enabled || !store) {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ enabled: false, recommendations: [] });
    }
    if (typeof store.listTossRecommendations !== 'function') {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(500).json({ code: 'DATABASE_ERROR', message: '추천 데이터를 불러오지 못했습니다.' });
    }

    try {
      const queryNow = currentDate(clock);
      const stored = await store.listTossRecommendations({ now: queryNow });
      const responseNow = currentDate(clock);
      const validStored = [];
      for (const item of Array.isArray(stored) ? stored : []) {
        const recommendation = toPublicRecommendation(item);
        if (!recommendation) continue;
        if (recommendation.endAt != null && Date.parse(recommendation.endAt) <= responseNow.getTime()) continue;
        validStored.push({ recommendation, lastSeenAt: item.lastSeenAt });
        if (validStored.length === 10) break;
      }
      const recommendations = validStored.map(({ recommendation }) => recommendation);
      const updatedTimes = validStored
        .map(({ lastSeenAt }) => new Date(lastSeenAt).getTime())
        .filter(Number.isFinite);
      const updatedTime = updatedTimes.length > 0
        ? Math.max(...updatedTimes)
        : responseNow.getTime();
      const updatedAt = new Date(updatedTime).toISOString();
      res.setHeader('Cache-Control', `public, max-age=${cacheSeconds(recommendations, responseNow)}, must-revalidate`);
      return res.json({
        enabled: true,
        updatedAt,
        count: recommendations.length,
        recommendations,
      });
    } catch (error) {
      console.error('토스쇼핑 추천 조회 실패:', error);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(500).json({ code: 'DATABASE_ERROR', message: '추천 데이터를 불러오지 못했습니다.' });
    }
  });

  return router;
}

module.exports = { createTossRecommendationsRouter, toPublicRecommendation };
