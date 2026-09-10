import {createHash} from 'node:crypto';
export const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const studentKey=(name,phone)=>hash([name.trim(),String(phone).replace(/\D/g,'')]);
export const recordId=r=>`${r.classId}_${r.date}_${r.studentKey}`;
export const editable=r=>({entry:r.entry,exit:r.exit,entryMemo:r.entryMemo,exitMemo:r.exitMemo});
export const version=r=>hash([r.studentKey,r.schedule,r.rawEntry,r.entry,r.exit,r.entryMemo,r.exitMemo,r.outings]);
