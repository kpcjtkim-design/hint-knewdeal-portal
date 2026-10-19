// 2기 사이트에서는 닫혀 있습니다: 1기 만족도 자동 동기화(1기 설문 카탈로그·1기 운영총괄·1기 Firebase로 빌드한 묶음)였습니다.
// 2기 만족도는 2기 카탈로그로 묶음(lib/survey-sync-runtime.cjs)을 다시 빌드한 뒤 cohort.json features.surveys와 함께 엽니다(tools/build-survey-sync.md).
module.exports=async function handler(req,res){res.setHeader('cache-control','no-store');return res.status(410).json({ok:false,code:'COHORT2_CLOSED',error:'2기 만족도 자동 동기화는 아직 열리지 않았습니다.'});};
