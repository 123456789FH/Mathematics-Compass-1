-- بعد إنشاء حسابك من المنصة، استبدلي 12345 برقم دخولك ثم شغّلي الأمر.
update public.profiles
set role='admin'
where membership_number='12345';

select full_name,membership_number,role
from public.profiles
where membership_number='12345';
