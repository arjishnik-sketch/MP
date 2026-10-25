-- 0003_staff_profiles.sql — idempotent Staff_Info.md profile facts.
-- Source: reference/SEMANTIC/Staff_Info.md, Table 1. Phone is already seeded
-- in 0001_reference_data.sql; the source's documented duty and weekly-off are
-- matched by phone so corrected Marathi name spellings in the canonical staff
-- seed do not lose the profile facts.

UPDATE staff_members AS s
SET duty_assignment = v.duty_assignment,
    weekly_off = v.weekly_off
FROM (VALUES
  ('8108871100', 'वरिश्ठ पोलीस निरीक्षक', 'रविवार'),
  ('8108064400', 'क्राईम', 'षुक्रवार'),
  ('8823245845', 'प्रशासन', 'सोमवार'),
  ('9821483757', 'तपास', 'षनिवार'),
  ('7020382702', 'गुन्हे शोध पथक', 'षनिवार'),
  ('7977799629', 'पंचवटी कारंजा चौकी', 'सोमवार'),
  ('9579393966', 'काटया मारूती चौकी', 'मंगळवार'),
  ('9421519540', 'फुलेनगर चौकी', 'षुक्रवार'),
  ('8805000403', 'मेरी चौकी', 'षनिवार'),
  ('9096203863', 'काटया मारूती चौकी', 'गुरूवार'),
  ('9552526635', 'मालेगाव स्टॅड चौकी', 'मंगळवार'),
  ('9370052999', 'फुलेनगर चौकी', 'मंगळवार'),
  ('7219190851', 'महिला॰ सायबर कक्ष', 'सोमवार'),
  ('8605040543', 'गंगाघाट', 'सोमवार'),
  ('8788537436', 'गंगाघाट', 'बुधवार'),
  ('8975204086', 'गंगाघाट', 'षनिवार')
) AS v(phone, duty_assignment, weekly_off)
WHERE s.phone = v.phone;
