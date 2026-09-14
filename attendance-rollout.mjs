export const modernAttendance=(user,profile)=>profile?.active!==false&&profile?.role==='ADMIN'&&['hint.kpc@gmail.com','kpc.jtkim@gmail.com'].includes(String(user?.email||'').trim().toLowerCase());
