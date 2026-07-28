-- بعد إنشاء حسابك من واجهة المنصة، ضعي بريدك بدل المثال ثم نفذي السطر:
update public.profiles
set role='admin'
where id=(select id from auth.users where email='YOUR_EMAIL@example.com');

-- لترقية مشرف آخر:
-- update public.profiles set role='supervisor'
-- where id=(select id from auth.users where email='SUPERVISOR@example.com');
