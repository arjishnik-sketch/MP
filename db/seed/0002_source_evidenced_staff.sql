-- 0002_source_evidenced_staff.sql — master rows the old seed lacked but
-- reference/SEMANTIC/10.md explicitly names. Zero invented people: every row below is
-- printed in the 10/09 source. Idempotent; reconcile on rank+name / rank+buckle.
-- (Migrations create schema; personnel live in seeds — db-change skill.)

-- Home Guard identities (night chart: कारंजा list + काळाराम गार्ड).
-- Source gives surname only ("होम 23520 खाडे"); name_mr stores exactly that.
INSERT INTO ranks (rank_code, name_mr, short_form_mr, cadre, display_order)
VALUES ('HOME_GUARD','होम गार्ड (होम)','होम','HOME_GUARD',17)
ON CONFLICT (rank_code) DO UPDATE SET name_mr=EXCLUDED.name_mr, short_form_mr=EXCLUDED.short_form_mr;

INSERT INTO staff_members (buckle_no, rank_code, name_mr)
VALUES
  ('23520','HOME_GUARD','खाडे'),
  ('23685','HOME_GUARD','शिंदे'),
  ('23613','HOME_GUARD','सोनवणे'),
  ('23638','HOME_GUARD','सांगळे'),
  ('23605','HOME_GUARD','भडांगे')
ON CONFLICT (rank_code, buckle_no) WHERE buckle_no IS NOT NULL DO NOTHING;

-- LPC staff named on the दामिनी/साधारण lists but absent from Staff_Info-derived seed.
INSERT INTO staff_members (buckle_no, rank_code, name_mr)
VALUES
  ('2699','LPC','पवार'),
  ('1061','LPC','पानसरे'),
  ('1799','LPC','बहिरम'),
  ('39','LPC','येवले')
ON CONFLICT (rank_code, buckle_no) WHERE buckle_no IS NOT NULL DO NOTHING;

-- "ग्रेपोउनि अशोक काकड" (पो.स्टे.रिझर्व्ह, Table 3). Master already holds ASI अशोक
-- लक्ष्मण काकड; whether the ग्रेपोउनि label is the same person or another is NOT
-- established — stored verbatim as source lists him (ambiguity recorded, never guessed).
INSERT INTO staff_members (buckle_no, rank_code, name_mr)
VALUES (NULL,'GRADE_PSI','अशोक काकड')
ON CONFLICT (rank_code, name_mr) DO NOTHING;
