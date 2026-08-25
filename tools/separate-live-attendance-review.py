from pathlib import Path

p = Path('attendance-test.html')
s = p.read_text(encoding='utf-8')
s = s.replace("return `attendanceReview_${selectedClass}_${String(label||'').replace(/[^0-9A-Za-z가-힣_-]+/g,'-')}`", "return `attendanceReviewLive_${selectedClass}_${String(label||'').replace(/[^0-9A-Za-z가-힣_-]+/g,'-')}`")
s = s.replace("type:'ATTENDANCE_REVIEW',source:'운영총괄_READ_ONLY'", "type:'ATTENDANCE_REVIEW_LIVE',source:'운영총괄_ORIGINAL_READ_ONLY'")
s = s.replace("source:'운영총괄_READ_ONLY',mode:'READ_ONLY_VIEWER'", "source:'운영총괄_ORIGINAL_READ_ONLY',mode:'READ_ONLY_VIEWER'")
p.write_text(s, encoding='utf-8')
