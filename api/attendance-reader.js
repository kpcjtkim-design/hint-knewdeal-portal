// 2기 사이트에서는 닫혀 있습니다: 1기 운영총괄(구글시트)을 읽던 리더입니다(1기는 cohort1 브랜치·1기 Vercel 프로젝트에 그대로 있음).
// 단위기간 출석부·통계·RAW·중도포기·만족도는 11월 중 2기 마스터시트 출결원장 기준으로 다시 엽니다. 1기 주소로 새지 않게 아무것도 부르지 않습니다.
export default function handler(req,res){res.setHeader('cache-control','no-store');return res.status(410).json({ok:false,code:'COHORT2_CLOSED',error:'2기 사이트에서는 1기 운영총괄 읽기를 쓰지 않습니다. 11월 중 2기 출결원장 기준으로 다시 엽니다.'});}
