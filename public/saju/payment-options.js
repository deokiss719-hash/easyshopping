(function(root){
 'use strict';
 const METHODS={KAKAOPAY:'카카오페이',TOSSPAY:'토스페이'};
 function paymentRequest(order,method){
  if(!Object.hasOwn(METHODS,method))throw Error('결제수단을 선택해 주세요.');
  if(!Number.isSafeInteger(order.amount)||order.amount<=0)throw Error('주문 금액을 확인해 주세요.');
  return {method:'CARD',card:{flowMode:'DIRECT',easyPay:method},
   amount:{currency:'KRW',value:order.amount},orderId:order.id,orderName:'나의 사주 기본 보고서',
   successUrl:order.successUrl,failUrl:order.failUrl,windowTarget:'self'};
 }
 const api={METHODS,paymentRequest};
 if(typeof module==='object')module.exports=api;else root.SajuPaymentOptions=api;
})(typeof window==='object'?window:globalThis);
