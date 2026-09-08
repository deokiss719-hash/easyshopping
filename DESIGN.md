---
version: alpha
name: Easy Shopping
description: 밝고 신뢰감 있는 모바일 중심 핫딜 정보 플랫폼 디자인 시스템.
colors:
  primary: "#005BFF"
  primary-hover: "#004DDA"
  deep-navy: "#001B5E"
  secondary-blue: "#1565C0"
  light-blue: "#EAF3FF"
  accent-red: "#D92D20"
  accent-yellow: "#FFB21C"
  text-primary: "#172033"
  text-secondary: "#667085"
  text-tertiary: "#98A2B3"
  surface: "#FFFFFF"
  background: "#F7F9FC"
  divider: "#EAECF0"
  success: "#16A66A"
typography:
  display:
    fontFamily: Pretendard
    fontSize: 3.5rem
    fontWeight: 800
    lineHeight: 1.12
    letterSpacing: "-0.04em"
  heading-1:
    fontFamily: Pretendard
    fontSize: 2rem
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  heading-2:
    fontFamily: Pretendard
    fontSize: 1.5rem
    fontWeight: 800
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  price:
    fontFamily: Pretendard
    fontSize: 1.375rem
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  body:
    fontFamily: Pretendard
    fontSize: 1rem
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "-0.01em"
  label:
    fontFamily: Pretendard
    fontSize: 0.8125rem
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.005em"
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  4xl: 72px
rounded:
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  pill: 999px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: 16px
    height: 52px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: 16px
    height: 52px
  button-secondary:
    backgroundColor: "{colors.light-blue}"
    textColor: "{colors.deep-navy}"
    rounded: "{rounded.md}"
    padding: 14px
    height: 48px
  product-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    padding: 20px
  badge-hot:
    backgroundColor: "{colors.accent-red}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: 6px
  badge-popular:
    backgroundColor: "{colors.accent-yellow}"
    textColor: "{colors.deep-navy}"
    rounded: "{rounded.pill}"
    padding: 6px
  category-selected:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: 12px
---

## Overview

이지쇼핑은 “그래서 지금 뭐가 싼데?”에 가장 빠르게 답하는 모바일 중심 핫딜 정보 서비스다. 시각적 목표는 신뢰감, 친근함, 속도감, 쉬운 가격 판단이다. 쇼핑 광고 배너나 복잡한 대시보드가 아니라 정돈된 소비자용 앱처럼 보여야 한다.

## Colors

- **Primary Blue (#005BFF):** CTA, 선택 상태, 핵심 링크에만 사용한다.
- **Deep Navy (#001B5E):** 워드마크와 강한 제목에 사용하며 완전한 검정보다 부드러운 신뢰감을 준다.
- **Light Blue (#EAF3FF):** 선택 전 카테고리, 아이콘 배경, 정보 강조 면에 사용한다.
- **Accent Red (#D92D20):** 할인율, HOT, 가격 하락에만 제한적으로 사용한다.
- **Accent Yellow (#FFB21C):** 인기와 추천 배지의 작은 포인트에만 사용한다.
- 화면의 70~80%는 White, Background, Light Blue 계열로 유지한다.

## Typography

Pretendard 단일 서체를 사용한다. 가격과 할인율은 빠른 비교를 위해 700~800 굵기를 유지한다. 본문과 보조 정보는 Dark Gray 계열로 표시하며 모바일에서 12px보다 작게 만들지 않는다.

## Layout

- 기본 콘텐츠 최대 폭은 1120px이며 중앙 정렬한다.
- 모바일은 20px, 태블릿은 28px, 데스크톱은 32px 이상의 좌우 여백을 둔다.
- Hero는 첫 화면을 독점하지 않고 상품 목록이 바로 보이도록 압축한다.
- 카드 내부는 16~20px, 섹션 사이는 64~88px을 기본으로 한다.
- 모바일 하단 탐색 높이는 안전 영역을 포함해 최소 68px이며 모든 터치 영역은 44px 이상이다.

## Elevation & Depth

테두리 대신 매우 연한 면 구분과 그림자를 사용한다. 기본 카드 그림자는 `0 8px 30px rgba(0,27,94,0.06)`이며 hover에서만 조금 선명해진다. 카드 이동은 최대 3px이다.

## Shapes

카드는 16~20px, 검색창은 18~24px, 버튼은 12~16px 곡률을 사용한다. 작은 배지만 pill 형태를 사용한다. 모든 요소를 과도하게 둥글게 만들지 않는다.

## Components

- **워드마크:** `EASY`의 E를 Primary Blue 블록으로 만들고 `이지쇼핑` 텍스트를 Deep Navy로 조합한다. 기존 이지폰 로고는 사용하지 않는다.
- **검색:** 메인 행동으로 인식되도록 크고 둥근 흰색 검색창과 분명한 focus ring을 사용한다.
- **상품 카드:** 현재가격 → 할인율 → 상품명 → 이미지 → 판매처 → 반응 순으로 시각적 우선순위를 둔다.
- **랭킹:** 별도 화려한 보드 없이 순위, 상품, 가격, 할인율, 반응을 한 줄에서 비교한다.
- **배지:** HOT은 Red, 인기/추천은 Yellow, 신규는 Light Blue를 사용한다.
- **내비게이션:** 데스크톱은 상단 sticky, 모바일은 핵심 상단 바와 5개 항목의 하단 내비게이션을 사용한다.
- **로딩:** 실제 카드와 동일한 크기의 skeleton을 사용하고 1.2초 이상의 느린 장식 애니메이션은 사용하지 않는다.

## Do's and Don'ts

### Do

- 첫 3초 안에 핫딜 서비스임을 이해하게 한다.
- 가격과 할인율을 가장 빠르게 비교하게 한다.
- 충분한 여백과 큰 터치 영역을 제공한다.
- Blue는 행동과 선택을 안내하는 데 사용한다.
- 모바일에서 읽기 쉬운 정보 크기를 유지한다.

### Don't

- algo-log 또는 Toss의 고유 레이아웃과 그래픽을 복제하지 않는다.
- 여행, 항공권, 호텔 기능을 넣지 않는다.
- 전체 배경을 Blue로 채우지 않는다.
- 과도한 gradient, neon, shadow, 광고 배너를 사용하지 않는다.
- 캐릭터를 반복 노출하거나 UI보다 눈에 띄게 만들지 않는다.
- 한 화면에 불필요한 지표와 장식 요소를 추가하지 않는다.
