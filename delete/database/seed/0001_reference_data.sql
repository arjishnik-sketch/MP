-- 0001_reference_data.sql — Layer A station master seed (idempotent, zero fictional data).
-- Provenance: old repo db/seed/reference-data.sql + structural.sql (INITIAL_AUDIT §2 — "copy, don't
-- regenerate"), adapted to the rebuilt schema. No daily operational rows here (those are the
-- 10/09 chart seed). Marshal posts are LOCATIONS (kind=MARSHAL_POST), not units.

-- Ranks: 16 canonical codes (protected tokens). Short form extracted from the "(…)" suffix.
INSERT INTO ranks (rank_code, name_mr, short_form_mr, cadre, display_order)
SELECT v.code, v.name,
       CASE WHEN v.name ~ '\(([^)]+)\)$' THEN regexp_replace(v.name, '.*\(([^)]+)\)$', '\1') END,
       v.cadre, v.ord
FROM (VALUES
  ('SR_PI','वरिष्ठ पोलीस निरीक्षक (वपोनि)','OFFICER',1),
  ('PI','पोलीस निरीक्षक (पोनि)','OFFICER',2),
  ('API','सहाय्यक पोलीस निरीक्षक (सपोनि)','OFFICER',3),
  ('PSI','पोलीस उपनिरीक्षक (पोउनि)','OFFICER',4),
  ('PROB_PSI','परिविक्षाधीन पोलीस उपनिरीक्षक (परि.पोउनि)','OFFICER',5),
  ('PROB_LPSI','परिविक्षाधीन महिला पोलीस उपनिरीक्षक (परि.मपोउनि)','OFFICER',6),
  ('GRADE_PSI','ग्रेड पोलीस उपनिरीक्षक (ग्रेपोउनि)','OFFICER',7),
  ('ASI','सहाय्यक पोलीस निरीक्षक (सपोउनि)','CONSTABULARY',8),
  ('LASI','महिला सहाय्यक पोलीस उपनिरीक्षक (मसपोउनि)','CONSTABULARY',9),
  ('HC','पोलीस हवालदार (पोहवा)','CONSTABULARY',10),
  ('DRIVER_HC','चालक पोलीस हवालदार (चापोहवा)','CONSTABULARY',11),
  ('LHC','महिला पोलीस हवालदार (मपोहवा)','CONSTABULARY',12),
  ('PN','पोलीस नाईक (पोना)','CONSTABULARY',13),
  ('PC','पोलीस शिपाई (पोशि)','CONSTABULARY',14),
  ('DRIVER_PC','चालक पोलीस शिपाई (चापोशि)','CONSTABULARY',15),
  ('LPC','महिला पोलीस शिपाई (मपोशि)','CONSTABULARY',16)
) AS v(code, name, cadre, ord)
ON CONFLICT (rank_code) DO UPDATE SET
  name_mr = EXCLUDED.name_mr,
  short_form_mr = EXCLUDED.short_form_mr,
  cadre = EXCLUDED.cadre,
  display_order = EXCLUDED.display_order;

-- Shifts: DAY / NIGHT (overnight NIGHT belongs to its start date).
INSERT INTO shifts (shift_code, title_mr, start_time, end_time, is_overnight) VALUES
  ('DAY','दिवसपाळी','09:00','21:00',FALSE),
  ('NIGHT','रात्रपाळी','21:00','09:00',TRUE)
ON CONFLICT (shift_code) DO UPDATE SET
  title_mr = EXCLUDED.title_mr, start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time, is_overnight = EXCLUDED.is_overnight;

-- Locations: station + six chowkis + five marshal posts (own बंद/charge state — DOMAIN three-fact)
-- + fixed points named in the source charts.
INSERT INTO locations (location_code, name_mr, kind, display_order, active) VALUES
  ('STATION_PANCHAVATI','पंचवटी पोलीस ठाणे','STATION',0,TRUE),
  ('CHOWKI_KATYA_MARUTI','काटया मारूती पोलीस चौकी','CHOWKI',1,TRUE),
  ('CHOWKI_KARANJA','पंचवटी कारंजा पोलीस चौकी','CHOWKI',2,TRUE),
  ('CHOWKI_MALEGAON_STAND','मालेगांव स्टॅड पोलीस चौकी','CHOWKI',3,TRUE),
  ('CHOWKI_SARDAR','सरदार पोलीस चौकी','CHOWKI',4,TRUE),
  ('CHOWKI_PHULENAGAR','फुलेनगर पोलीस चौकी','CHOWKI',5,TRUE),
  ('CHOWKI_MERI','मेरी पोलीस चौकी','CHOWKI',6,TRUE),
  ('MARSHAL_KATYA_MARUTI','काटया मारूती मार्शल','MARSHAL_POST',11,TRUE),
  ('MARSHAL_KARANJA','पंचवटी कारंजा मार्शल','MARSHAL_POST',12,TRUE),
  ('MARSHAL_MALEGAON_STAND','मालेगांव स्टॅड मार्शल','MARSHAL_POST',13,TRUE),
  ('MARSHAL_PHULENAGAR','फुले नगर मार्शल','MARSHAL_POST',14,TRUE),
  ('MARSHAL_MERI','मेरी मार्शल','MARSHAL_POST',15,TRUE),
  ('FIXED_KALARAM','काळाराम मंदीर गार्ड','FIXED_POINT',21,TRUE),
  ('FIXED_RAMKUND','रामकुंड','FIXED_POINT',22,TRUE),
  ('FIXED_MARKET_YARD','मार्केट यार्ड पोलीस मदत केंद्र','FIXED_POINT',23,TRUE)
ON CONFLICT (location_code) DO UPDATE SET
  name_mr = EXCLUDED.name_mr, kind = EXCLUDED.kind,
  display_order = EXCLUDED.display_order, active = EXCLUDED.active;

-- Patrol units + chowki-in-charge routing token (marshal posts live in locations now).
INSERT INTO units (unit_code, name_mr, unit_type, display_order) VALUES
  ('CR_MOBILE','सी.आर. मोबाईल','PATROL_MOBILE',1),
  ('DELTA_MOBILE','डेल्टा मोबाईल','PATROL_MOBILE',2),
  ('DB_MOBILE','डी.बी. मोबाईल','PATROL_MOBILE',3),
  ('CHOWKI_INCHARGE','चौकीचे ईन्चार्ज अंमलदार','CHOWKI_INCHARGE',4)
ON CONFLICT (unit_code) DO UPDATE SET
  name_mr = EXCLUDED.name_mr, unit_type = EXCLUDED.unit_type, display_order = EXCLUDED.display_order;

-- Scan sessions (station-stable configuration).
INSERT INTO scan_sessions (session_code, title_mr, start_time, end_time, is_overnight, display_order) VALUES
  ('SCAN_MORNING','सकाळ सत्र','09:00','15:00',FALSE,1),
  ('SCAN_AFTERNOON','दुपार सत्र','15:00','21:00',FALSE,2),
  ('SCAN_HOURLY','बिट मार्शल व ऑफिस स्टाफ अंमलदार','09:00','21:00',FALSE,3),
  ('SCAN_NIGHT','रात्री सत्र','21:00','09:00',TRUE,4)
ON CONFLICT (session_code) DO UPDATE SET
  title_mr = EXCLUDED.title_mr, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
  is_overnight = EXCLUDED.is_overnight, display_order = EXCLUDED.display_order;

-- Duty catalog: stable recurring positions (adapted from old reference-data.sql; section_code
-- is display grouping only — never a page table).
INSERT INTO duty_definitions (duty_code, title_mr, section_code, default_shift, location_id, display_order)
SELECT v.code, v.title, v.section, v.shift,
       (SELECT l.location_id FROM locations l WHERE l.location_code = v.loc), v.ord
FROM (VALUES
  ('DAY_STATION_LEADERSHIP','ठाणे / वरिष्ठ अधिकारी','DAY_DEPLOYMENT','DAY',NULL,1),
  ('DAY_PSO','ठाणे अंमलदार','DAY_DEPLOYMENT','DAY',NULL,2),
  ('DAY_HAZARI','हजरपाळी','DAY_DEPLOYMENT','DAY',NULL,3),
  ('DAY_CCTNS','CCTNS','DAY_DEPLOYMENT','DAY',NULL,4),
  ('DAY_WIRELESS','वायरलेस','DAY_DEPLOYMENT','DAY',NULL,5),
  ('DAY_PETER','पिटर मोबाईल','DAY_DEPLOYMENT','DAY',NULL,6),
  ('DAY_CR','सी.आर. मोबाईल','DAY_DEPLOYMENT','DAY',NULL,7),
  ('DAY_DELTA','डेल्टा मोबाईल','DAY_DEPLOYMENT','DAY',NULL,8),
  ('DAY_DB','गुन्हे शोध पथक/DB','DAY_DEPLOYMENT','DAY',NULL,9),
  ('DAY_LOCKUP','पो.स्टे. लॉकअप गार्ड','DAY_DEPLOYMENT','DAY',NULL,10),
  ('DAY_KATYA','काटया मारूती पोलीस चौकी','DAY_DEPLOYMENT','DAY','CHOWKI_KATYA_MARUTI',11),
  ('DAY_KARANJA','पंचवटी कारंजा पोलीस चौकी','DAY_DEPLOYMENT','DAY','CHOWKI_KARANJA',12),
  ('DAY_MALEGAON','मालेगांव स्टॅड चौकी','DAY_DEPLOYMENT','DAY','CHOWKI_MALEGAON_STAND',13),
  ('DAY_SARDAR','सरदार पोलीस चौकी','DAY_DEPLOYMENT','DAY','CHOWKI_SARDAR',14),
  ('DAY_PHULE','फुलेनगर पोलीस चौकी','DAY_DEPLOYMENT','DAY','CHOWKI_PHULENAGAR',15),
  ('DAY_MERI','मेरी पोलीस चौकी','DAY_DEPLOYMENT','DAY','CHOWKI_MERI',16),
  ('DAY_WOMEN_DESK','महिला कक्ष','DAY_DEPLOYMENT','DAY',NULL,17),
  ('DAY_KALARAM','काळाराम मंदीर गार्ड ड्युटी','DAY_DEPLOYMENT','DAY','FIXED_KALARAM',18),
  ('DAY_CYBER','सायबर सेल','DAY_DEPLOYMENT','DAY',NULL,19),
  ('DAY_PANCHAVATI1','पंचवटी 1 मोबाईल','DAY_DEPLOYMENT','DAY',NULL,20),
  ('DAY_MARSHAL_KATYA','काटया मारूती मार्शल','DAY_DEPLOYMENT','DAY','MARSHAL_KATYA_MARUTI',21),
  ('DAY_MARSHAL_KARANJA','पंचवटी कारंजा मार्शल','DAY_DEPLOYMENT','DAY','MARSHAL_KARANJA',22),
  ('DAY_MARSHAL_MALEGAON','मालेगांव स्टॅड मार्शल','DAY_DEPLOYMENT','DAY','MARSHAL_MALEGAON_STAND',23),
  ('DAY_MARSHAL_PHULE','फुले नगर मार्शल','DAY_DEPLOYMENT','DAY','MARSHAL_PHULENAGAR',24),
  ('DAY_MARSHAL_MERI','मेरी मार्शल','DAY_DEPLOYMENT','DAY','MARSHAL_MERI',25),
  ('OFFICE_WRITER','व.पो.नि.साो. रायटर','OFFICE','DAY',NULL,30),
  ('OFFICE_CASHIER','नगदी कारकुन','OFFICE','DAY',NULL,31),
  ('OFFICE_PROPERTY','मुद्देमाल कारकुन','OFFICE','DAY',NULL,32),
  ('OFFICE_CONFIDENTIAL','गोपनिय ड्युटी','OFFICE','DAY',NULL,33),
  ('OFFICE_HAZARI_MASTER','हजेरी मास्तर','OFFICE','DAY',NULL,34),
  ('OFFICE_CRIME','क्राईम कारकुन','OFFICE','DAY',NULL,35),
  ('OFFICE_BARANISHI','बारनिषी','OFFICE','DAY',NULL,36),
  ('OFFICE_MISSING','MOB/मिसिंग','OFFICE','DAY',NULL,37),
  ('OFFICE_WARRANT','वारंट','OFFICE','DAY',NULL,38),
  ('OFFICE_SESSION_SUMMONS','सेशन समन्स','OFFICE','DAY',NULL,39),
  ('OFFICE_SUMMONS','समन्स','OFFICE','DAY',NULL,40),
  ('OFFICE_ATC','मो.मिसिंग/ए.टी.सी.सेल','OFFICE','DAY',NULL,41),
  ('NIGHT_CHECKING_OFFICER','रात्र गस्त अधिकारी','NIGHT_DEPLOYMENT','NIGHT',NULL,1),
  ('NIGHT_PSO','ठाणे अंमलदार','NIGHT_DEPLOYMENT','NIGHT',NULL,2),
  ('NIGHT_HAZARI','हजरपाळी','NIGHT_DEPLOYMENT','NIGHT',NULL,3),
  ('NIGHT_CCTNS','CCTNS','NIGHT_DEPLOYMENT','NIGHT',NULL,4),
  ('NIGHT_WIRELESS','वायरलेस','NIGHT_DEPLOYMENT','NIGHT',NULL,5),
  ('NIGHT_PETER','पिटर मोबाईल','NIGHT_DEPLOYMENT','NIGHT',NULL,6),
  ('NIGHT_CR','सी.आर. मोबाईल','NIGHT_DEPLOYMENT','NIGHT',NULL,7),
  ('NIGHT_DB','गुन्हे शोध पथक/DB','NIGHT_DEPLOYMENT','NIGHT',NULL,8),
  ('NIGHT_LOCKUP','पो.स्टे. लॉकअप गार्ड','NIGHT_DEPLOYMENT','NIGHT',NULL,9),
  ('NIGHT_KATYA','काटया मारूती पोलीस चौकी','NIGHT_DEPLOYMENT','NIGHT','CHOWKI_KATYA_MARUTI',10),
  ('NIGHT_KARANJA','पंचवटी कारंजा पोलीस चौकी','NIGHT_DEPLOYMENT','NIGHT','CHOWKI_KARANJA',11),
  ('NIGHT_MALEGAON','मालेगांव स्टॅड चौकी','NIGHT_DEPLOYMENT','NIGHT','CHOWKI_MALEGAON_STAND',12),
  ('NIGHT_SARDAR','सरदार पोलीस चौकी','NIGHT_DEPLOYMENT','NIGHT','CHOWKI_SARDAR',13),
  ('NIGHT_PHULE','फुलेनगर पोलीस चौकी','NIGHT_DEPLOYMENT','NIGHT','CHOWKI_PHULENAGAR',14),
  ('NIGHT_MERI','मेरी पोलीस चौकी','NIGHT_DEPLOYMENT','NIGHT','CHOWKI_MERI',15),
  ('NIGHT_PANCHAVATI1','पंचवटी 1 मोबाईल','NIGHT_DEPLOYMENT','NIGHT',NULL,16),
  ('NIGHT_KALARAM','काळाराम मंदीर गार्ड ड्युटी','NIGHT_DEPLOYMENT','NIGHT','FIXED_KALARAM',17),
  ('NIGHT_GOOD_MORNING','गुड मॉर्निंग पथक','NIGHT_DEPLOYMENT','NIGHT',NULL,18),
  ('NIGHT_RAMKUND','रामकुंड परिसरात पेट्रोलिंग','NIGHT_DEPLOYMENT','NIGHT','FIXED_RAMKUND',19),
  ('NIGHT_MARSHAL_KATYA','काटया मारूती मार्शल','NIGHT_DEPLOYMENT','NIGHT','MARSHAL_KATYA_MARUTI',20),
  ('NIGHT_MARSHAL_KARANJA','पंचवटी कारंजा मार्शल','NIGHT_DEPLOYMENT','NIGHT','MARSHAL_KARANJA',21),
  ('NIGHT_MARSHAL_MALEGAON','मालेगांव स्टॅड मार्शल','NIGHT_DEPLOYMENT','NIGHT','MARSHAL_MALEGAON_STAND',22),
  ('NIGHT_MARSHAL_PHULE','फुले नगर मार्शल','NIGHT_DEPLOYMENT','NIGHT','MARSHAL_PHULENAGAR',23),
  ('NIGHT_MARSHAL_MERI','मेरी मार्शल','NIGHT_DEPLOYMENT','NIGHT','MARSHAL_MERI',24)
) AS v(code, title, section, shift, loc, ord)
ON CONFLICT (duty_code) DO UPDATE SET
  title_mr = EXCLUDED.title_mr, section_code = EXCLUDED.section_code,
  default_shift = EXCLUDED.default_shift, location_id = EXCLUDED.location_id,
  display_order = EXCLUDED.display_order;

-- Staff master: 169 source rows (buckled reconcile on rank+buckle; unbuckled on rank+name).
-- active defaults TRUE.
INSERT INTO staff_members (buckle_no, rank_code, name_mr, phone)
VALUES
  ('97','HC','रमेश हिरामण गावित','8652890808'),
  ('245','HC','संजय सखाराम वाघमारे','9823417245'),
  ('391','HC','कैलास नारायण शिंदे','8380066391'),
  ('416','HC','संतोष विष्णु नवले','9850095218'),
  ('443','HC','संतोष रामचंद्र कोरडे','7030775400'),
  ('477','HC','सागर नामदेव पांडे','8766722837'),
  ('480','HC','राजेश दशरथ सोळसे','8823888770'),
  ('490','HC','किरण आबाजी सानप','9823266490'),
  ('500','HC','सोमनाथ काशिनाथ गावित','9657861262'),
  ('509','HC','संदीप शिवाजी बाविस्कर','9923825277'),
  ('531','HC','संजय भरतसिंग राठोड','9892136013'),
  ('632','HC','किशोर रघुनाथ आहेर','9823131166'),
  ('692','HC','अनिल बाळु गुंबाडे','8329360364'),
  ('742','HC','शरद रामदास ठाकरे','9850974087'),
  ('792','HC','मनोज भास्कर चांडोले','8888870403'),
  ('842','HC','सचिन उत्तम आहिरे','9922007472'),
  ('936','HC','सचिन विष्णु अहिरराव','9823979936'),
  ('1045','HC','अनिल रामचंद्र सोर','9881909179'),
  ('1067','HC','मंगेश रामु जाधव','9923191703'),
  ('1091','HC','आनंदा संपत गारे','9822153760'),
  ('1089','HC','नरेंद्र रंगनाथ कोरडे','9284692851'),
  ('1126','DRIVER_HC','योगेश नामदेव शिंदे','9594982001'),
  ('1347','HC','संतोष प्रकाश जाधव','9422476879'),
  ('1381','HC','रविंद्र केशव सोनवणे','9823516795'),
  ('1425','HC','अभिजीत सोपान पैठणकर','9923490404'),
  ('1447','HC','भास्कर दामोदर मल्ले','9823041447'),
  ('1452','HC','संदीप देवराम लांडे','9666974435'),
  ('1558','HC','अमोल बाळासाहेब काळे','9922941558'),
  ('1693','HC','केशव राजाराम भोये','9011521693'),
  ('1717','HC','निलेश रामसिंग चव्हाण','9823876634'),
  ('1761','HC','संतोष नंदु पवार','7387841446'),
  ('1867','HC','महेश तुकाराम नांदुर्डीकर','9823162376'),
  ('2042','HC','नवनाथ वाल्मीक रोकडे','9552456003'),
  ('2100','HC','अमोल नाना पाटील','8308482100'),
  ('2502','HC','लक्ष्मण हिरामण ठेपणे','9552541410'),
  ('2712','HC','मंगेश्वर महादु काकुळदे','8329912994'),
  ('2721','HC','संदीप संपत सानप','9594926644'),
  ('680','HC','विषाल अशोक देसले',NULL),
  ('980','DRIVER_HC','संदीप सुरेश मोरे','9892351315'),
  ('125','LHC','जयश्री दंुडाप्पा मोर्ती','9322171566'),
  ('1408','LHC','उषा अर्जन भरसट','9763723432'),
  ('1617','LHC','सोनाली बाळासाहेब वडाळकर','7447509560'),
  ('1726','LHC','शोभा काशिनाथ गवळी','7030739507'),
  ('1734','LHC','लिला बाळु गावित','9673216665'),
  ('1819','LHC','मंगल माधव सानप','8378947643'),
  ('1882','LHC','उर्मिला भिमसिंग पाडवी','8888778882'),
  ('1982','LHC','विजया शांताराम ठाकरे','9657015982'),
  ('2081','LHC','प्रियंका पांडुरंग पवार','9158543333'),
  ('2729','LHC','अर्चना किशोर पाटील','8459180624'),
  ('607','PN','जयवंत जगन्नाथ लोणारे','9594913886'),
  ('67','PC','रमेश नारायण देवरे','9970669576'),
  ('106','PC','आकाश विठ्ठल साताळकर','9112909253'),
  ('180','PC','अंकुश अरूण काळे','7218669210'),
  ('297','PC','संदीप नारायण जाधव','9324393948'),
  ('341','PC','सागर विलास पांढरे','8080668486'),
  ('352','PC','अमोल अरूण देशमुख','8888828985'),
  ('426','DRIVER_PC','गणेश गोरक्षनाथ शिकारे','8208279101'),
  ('530','PC','मोहन सुभाष निकम','9673720472'),
  ('542','PC','हेमंत रमाकांत आहेर','9421381901'),
  ('569','PC','यश विकास पवार','7620938680'),
  ('597','PC','विनोद यशवंत चितळकर','9082671416'),
  ('769','PC','शरद मनोहर नागरे','9373920375'),
  ('913','PC','शंकर नामदेव गंदलवाड','9096215742'),
  ('973','PC','गणेश धर्मा आगोणे','9175294777'),
  ('1020','PC','दीपक रामचंद्र डावरे','9524936823'),
  ('1025','PC','योगेश सिताराम वायकंडे','9923701315'),
  ('1036','DRIVER_PC','यशवंत गोकुळ पाटील','9823161446'),
  ('1243','DRIVER_PC','कैलास रामचंद्र महाले','8888847387'),
  ('1244','PC','योगेश मगन महाले','9011881100'),
  ('1345','PC','संतोष विलास पाटील','9657721381'),
  ('1358','PC','सोमकांत तुळशीराम भालेराव','9922354376'),
  ('1426','PC','अंबादास दशरथ तांदळे','9607528576'),
  ('1434','PC','शुभम नितीन तुपलोंढे','9545907514'),
  ('1457','PC','भूषण षेखर साळवे','7057867698'),
  ('1474','PC','दिपराज विनायक पवार','7972979252'),
  ('1644','PC','राहुल संपत गायकवाड','8007857139'),
  ('1709','PC','संदीप पोपट गडदे','9923725569'),
  ('1836','PC','दत्तात्रय रंगनाथ शेळके','8424015008'),
  ('1881','PC','तुषार बाळासाहेब जाधव','9890326529'),
  ('1996','PC','ज्ञानेश्वर आनंदा पालवी','9922447211'),
  ('1998','PC','कैलास बाळु वाकचैरे','9881069095'),
  ('2046','PC','प्रविण अशोक साळवे','9307884536'),
  ('2047','PC','सचिन भानुदास पाटील','7722003390'),
  ('2069','PC','विलास बाळु चारोस्कर','8888880609'),
  ('2073','PC','अतुल सुधीर ठाकुर','9850934977'),
  ('2089','PC','योगेश नारायण कदम','9011881100'),
  ('2137','PC','संतोष विठ्ठल मोरे','9763712137'),
  ('2144','PC','नितिनकुमार भाउसाहेब पवार','8888865859'),
  ('2149','PC','प्रमोद रामदास खैरनार','8275200828'),
  ('2157','PC','राजू रामदास गुंजाळ','9420232743'),
  ('2167','PC','सागर विलास चौधरी','8788103547'),
  ('2185','PC','विक्रांत अशोक नागरे','9272183156'),
  ('2236','PC','राहुल रमेश लभडे','9860351197'),
  ('2239','PC','संतोष सिताराम वाघ','7722002218'),
  ('2271','PC','युवराज पुंडलिक गायकवाड','9011385844'),
  ('2272','PC','किसन पोपट गायकवाड','9673709703'),
  ('2312','PC','अक्षय बाळु भाबड','9604574935'),
  ('2321','PC','नितीन भाऊसाहेब चोरघे','9730909052'),
  ('2351','PC','दिनेश धनराज निमजे','8888664152'),
  ('2357','PC','शिवम सिताराम साबळे','9028124046'),
  ('2377','PC','श्रीकांत रामचंद्र साळवे','9850185788'),
  ('2385','PC','हर्षल रमेश बोरसे','9545703343'),
  ('2394','PC','सचिन नितीन बहिकर','9096703144'),
  ('2440','PC','अश्विन हिरालाल कुमावत','7972498739'),
  ('2507','PC','वैभव पृथ्वीराज परदेशी','9923230964'),
  ('2512','PC','नितिन कैलास जगताप','8208173019'),
  ('2517','PC','सतीश सुभाष घाडगे','9767647123'),
  ('2523','PC','दीपक भगवान शिलावट','9011800292'),
  ('2539','PC','अमर विठ्ठल निरघुडे','7058716396'),
  ('2548','PC','प्रदिप कचरू जोंधळे','9623694156'),
  ('2553','PC','तुषार भरत मोकळ','9028589181'),
  ('2571','PC','भरत गोविंद देशमुख','9767922515'),
  ('2693','PC','अंकुश शिवाजी सोनजे','9822446660'),
  ('2759','PC','संदीप गोपीनाथ पवार','9850439089'),
  ('2904','PC','शिवम विजय सावंत','9623731964'),
  ('2914','PC','हेमंत नथ्थु रोकडे','8379858283'),
  ('2103','PC','अनंता बळवंत महाले','9767892203'),
  ('29','LPC','माया पोपट कामडे','8446120795'),
  ('641','LPC','सानिका पुंडलिक केदारे','7822895378'),
  ('669','LPC','मयुरी अर्जन गांगुर्डे','9325220847'),
  ('852','LPC','तृशाली प्रकाश दिवाणे','7020917224'),
  ('899','LPC','सोनाली बंडोपंत लहरे','8669841701'),
  ('945','LPC','नयन निवास देशमुख','9850961002'),
  ('1006','LPC','सिमा लक्ष्मणबाबु जयस्वाल','9970605751'),
  ('1014','LPC','प्रियंका प्रल्हाद गोसावी','7798134134'),
  ('1136','LPC','सोनाली विनायक भालेराव','8421990900'),
  ('1421','LPC','सरिता रावसाहेब शेळके','9158250116'),
  ('1559','LPC','सुनिता उत्तम भोये','9168515054'),
  ('1858','LPC','रेखा शंकर देशमुख','9604686270'),
  ('2033','LPC','सपना फुलसिंग कोकणी','8805537333'),
  ('2198','LPC','जयश्री तुळशीराम वाळुंज','9561062198'),
  ('2203','LPC','रोहिणी नामदेव साबळे','7249721941'),
  ('2207','LPC','सुनिता मनोहर साबळे','8856941418'),
  ('2208','LPC','सुवर्णा बाबुराव गवळी','8999964051'),
  ('2626','LPC','साधना विलास शिंदे','8805761850'),
  ('2639','LPC','स्वाती दत्तात्रय QM','9096926489'),
  ('2658','LPC','तनुजा बबन शिंदे','7841905586'),
  ('2666','LPC','भारती यादव भोसले','9158573804'),
  ('2667','LPC','रोहिणी शिवाजी उगले','8446279068'),
  ('2670','LPC','रोहिणी विठ्ठल भोईर','9356888758'),
  ('2671','LPC','पुजा शरदराव गवारे','7057144001'),
  ('2677','LPC','रोहिणी अंबादास संवद्रे','9822700703'),
  ('2679','LPC','शीतल रंगनाथ शिंदे','7517647970'),
  ('2829','LPC','दिपाली नाना शेलार','9923471143'),
  ('2912','LPC','उर्मिला गौतम गाढवे','9359795024')
ON CONFLICT (rank_code, buckle_no) WHERE buckle_no IS NOT NULL DO UPDATE SET
  name_mr = EXCLUDED.name_mr,
  phone = COALESCE(EXCLUDED.phone, staff_members.phone),
  active = TRUE;

-- Officers / probationers (no buckle): reconcile on rank+name.
INSERT INTO staff_members (buckle_no, rank_code, name_mr, phone)
VALUES
  (NULL,'SR_PI','गजेंद्र रघुनाथ पाटील','8108871100'),
  (NULL,'PI','सुनिल नारायण पवार','8108064400'),
  (NULL,'PI','नितीन आबाजी आंधळे','8823245845'), -- spelling per SEMANTIC/10.md (text authority)
  (NULL,'PI','सुधीर महादेव पाटील','9821483757'),
  (NULL,'API','सतिश नामदेव शिरसाठ','7020382702'),
  (NULL,'API','प्रशांत रामदास बोरसे','7977799629'),
  (NULL,'API','हेमंत विजय मोहिते','9579393966'),
  (NULL,'API','शरद देविदास पाटील','9421519540'),
  (NULL,'PSI','कैलास संतोश जाधव','8805000403'),
  (NULL,'PSI','प्रकाश अभिमान नेमाणे','9096203863'),
  (NULL,'PSI','सचिन अरूण चव्हाण','9552526635'),
  (NULL,'PSI','पुंडलिक धोंडीराम पावसे','9370052999'),
  (NULL,'PROB_LPSI','अर्चना संभाजी वाघ','7219190851'),
  (NULL,'PROB_PSI','सुनिल सुधाकर ठेंग','8605040543'),
  (NULL,'PROB_PSI','प्रतिक राजेंद्रराव राऊत','8788537436'),
  (NULL,'PROB_PSI','अशोक संताराम दिंडे','8975204086'),
  (NULL,'ASI','अशोक लक्ष्मण काकड','9823302234'),
  (NULL,'ASI','सुनिल पोपटराव शेवाळे','9881491407'),
  (NULL,'ASI','दत्तु बुधाजी शेळके','9923139092'),
  (NULL,'ASI','सुनिल दशरथ सोळसे','8380070900'),
  (NULL,'ASI','सागर प्रभाकर कुलकर्णी','9022403046'),
  (NULL,'LASI','पदमा वामन गावित','9767777283'),
  (NULL,'LASI','पार्वती रमेश राठोड','9850572715'),
  (NULL,'LASI','पुष्पा जगन चौधरी','9762971006')
ON CONFLICT (rank_code, name_mr) DO UPDATE SET
  phone = COALESCE(EXCLUDED.phone, staff_members.phone),
  active = TRUE;

-- Page-6 scan schedule routing config (30 structural rows: 6 + 6 + 12 + 6).
-- Marshal routing points at MARSHAL_POST locations (three-fact distinction).
INSERT INTO scan_schedule_config
  (session_code, location_id, sequence, start_time, end_time, patrol_unit_code, marshal_location_id)
SELECT s.session_code, l.location_id, v.seq, v.st::time, v.en::time,
       v.patrol, ml.location_id
FROM (VALUES
  ('SCAN_MORNING','CHOWKI_MERI',1,NULL,NULL,'CHOWKI_INCHARGE','MARSHAL_MERI'),
  ('SCAN_MORNING','CHOWKI_PHULENAGAR',2,NULL,NULL,'CHOWKI_INCHARGE','MARSHAL_PHULENAGAR'),
  ('SCAN_MORNING','CHOWKI_KATYA_MARUTI',3,NULL,NULL,'CHOWKI_INCHARGE','MARSHAL_KATYA_MARUTI'),
  ('SCAN_MORNING','CHOWKI_KARANJA',4,NULL,NULL,'CHOWKI_INCHARGE','MARSHAL_KARANJA'),
  ('SCAN_MORNING','CHOWKI_MALEGAON_STAND',5,NULL,NULL,'CHOWKI_INCHARGE','MARSHAL_MALEGAON_STAND'),
  ('SCAN_MORNING','CHOWKI_SARDAR',6,NULL,NULL,'CHOWKI_INCHARGE','MARSHAL_MALEGAON_STAND'),
  ('SCAN_AFTERNOON','CHOWKI_MERI',1,NULL,NULL,'CR_MOBILE','MARSHAL_MERI'),
  ('SCAN_AFTERNOON','CHOWKI_PHULENAGAR',2,NULL,NULL,'CR_MOBILE','MARSHAL_PHULENAGAR'),
  ('SCAN_AFTERNOON','CHOWKI_KATYA_MARUTI',3,NULL,NULL,'DELTA_MOBILE','MARSHAL_KATYA_MARUTI'),
  ('SCAN_AFTERNOON','CHOWKI_KARANJA',4,NULL,NULL,'DELTA_MOBILE','MARSHAL_KARANJA'),
  ('SCAN_AFTERNOON','CHOWKI_MALEGAON_STAND',5,NULL,NULL,'DB_MOBILE','MARSHAL_MALEGAON_STAND'),
  ('SCAN_AFTERNOON','CHOWKI_SARDAR',6,NULL,NULL,'DB_MOBILE','MARSHAL_MALEGAON_STAND'),
  ('SCAN_HOURLY','CHOWKI_MERI',1,'09:00','10:00',NULL,NULL),
  ('SCAN_HOURLY','CHOWKI_MALEGAON_STAND',2,'10:00','11:00',NULL,NULL),
  ('SCAN_HOURLY','CHOWKI_KATYA_MARUTI',3,'11:00','12:00',NULL,NULL),
  ('SCAN_HOURLY','CHOWKI_KARANJA',4,'12:00','13:00',NULL,NULL),
  ('SCAN_HOURLY','CHOWKI_PHULENAGAR',5,'13:00','14:00',NULL,NULL),
  ('SCAN_HOURLY','CHOWKI_SARDAR',6,'14:00','15:00',NULL,NULL),
  ('SCAN_HOURLY','CHOWKI_MERI',7,'15:00','16:00',NULL,NULL),
  ('SCAN_HOURLY','CHOWKI_MALEGAON_STAND',8,'16:00','17:00',NULL,NULL),
  ('SCAN_HOURLY','CHOWKI_KATYA_MARUTI',9,'17:00','18:00',NULL,NULL),
  ('SCAN_HOURLY','CHOWKI_KARANJA',10,'18:00','19:00',NULL,NULL),
  ('SCAN_HOURLY','CHOWKI_PHULENAGAR',11,'19:00','20:00',NULL,NULL),
  ('SCAN_HOURLY','CHOWKI_SARDAR',12,'20:00','21:00',NULL,NULL),
  ('SCAN_NIGHT','CHOWKI_PHULENAGAR',1,NULL,NULL,NULL,'MARSHAL_MERI'),
  ('SCAN_NIGHT','CHOWKI_MERI',2,NULL,NULL,NULL,'MARSHAL_MERI'),
  ('SCAN_NIGHT','CHOWKI_KATYA_MARUTI',3,NULL,NULL,'CR_MOBILE',NULL),
  ('SCAN_NIGHT','CHOWKI_KARANJA',4,NULL,NULL,'DB_MOBILE',NULL),
  ('SCAN_NIGHT','CHOWKI_MALEGAON_STAND',5,NULL,NULL,NULL,'MARSHAL_MALEGAON_STAND'),
  ('SCAN_NIGHT','CHOWKI_SARDAR',6,NULL,NULL,NULL,'MARSHAL_MALEGAON_STAND')
) AS v(session_code, loc_code, seq, st, en, patrol, marshal_loc)
JOIN scan_sessions s ON s.session_code = v.session_code
JOIN locations l ON l.location_code = v.loc_code
LEFT JOIN units u ON u.unit_code = v.patrol
LEFT JOIN locations ml ON ml.location_code = v.marshal_loc
ON CONFLICT (session_code, sequence) DO UPDATE SET
  location_id = EXCLUDED.location_id,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  patrol_unit_code = EXCLUDED.patrol_unit_code,
  marshal_location_id = EXCLUDED.marshal_location_id;

-- Default station template + its first version (seed data, not chart data).
INSERT INTO chart_templates (name, is_default) VALUES ('Panchavati Compact v3', TRUE)
ON CONFLICT (name) DO NOTHING;
INSERT INTO template_versions (template_id, note, created_by)
SELECT t.template_id, 'Initial version — compact-v3 visual baseline', 'seed'
FROM chart_templates t
WHERE t.name = 'Panchavati Compact v3'
  AND NOT EXISTS (SELECT 1 FROM template_versions tv WHERE tv.template_id = t.template_id);

-- Template owns column DISPLAY ORDER (Layer C: heading order/visibility — architecture
-- element-classification table). Fill-if-empty only: never clobber clerk template edits.
-- matrixColumns keys = manpower_records.column_key values; label = rendered heading.
UPDATE template_versions tv
SET layout = tv.layout || '{
  "matrixColumns": [
    {"key":"PI","label":"PI"}, {"key":"API","label":"API"}, {"key":"PSI","label":"PSI"},
    {"key":"GPS","label":"GPS"}, {"key":"ASI","label":"ASI"}, {"key":"LASI","label":"LASI"},
    {"key":"LASI#2","label":"LASI"}, {"key":"HC","label":"HC"}, {"key":"LHC","label":"LHC"},
    {"key":"PN","label":"PN"}, {"key":"LPN","label":"LPN"}, {"key":"PC","label":"PC"},
    {"key":"LPC","label":"LPC"}, {"key":"OFFICE","label":"Office"}, {"key":"ME","label":"ME"}
  ],
  "shiftSummaryColumns": ["अधिकारी", "अंमलदार", "महिला अंमलदार", "एकूण"]
}'::jsonb
WHERE (tv.layout = '{}'::jsonb OR tv.layout IS NULL)
  AND tv.template_id = (SELECT template_id FROM chart_templates WHERE name = 'Panchavati Compact v3');

-- Court-desk split for the page-1 band (Layer C display grouping; merge, never clobber).
UPDATE template_versions tv
SET layout = tv.layout || '{"courtDutyCodes":["OFFICE_MISSING","OFFICE_ATC","OFFICE_WARRANT","OFFICE_SESSION_SUMMONS","OFFICE_SUMMONS"]}'::jsonb
WHERE NOT (tv.layout ? 'courtDutyCodes')
  AND tv.template_id = (SELECT template_id FROM chart_templates WHERE name = 'Panchavati Compact v3');

-- Page-1 officer boxes (.g-off grid): each station-officer post is bound by the source's own
-- role/qualifier token (SEMANTIC/10.md Table 1 col 1) and to the office-column writer row the
-- source names for that branch (col 4). Display grouping only (Layer C) — no operational data.
-- Replaces the earlier flat officerBoxWriters object (shape change → replace, still idempotent).
-- THREE boxes, not four (user 2026-10-14: “we have three officers only … 1st is the main one I
-- got confused, we have their box above big and all, so yeah just three”). The Sr-PI card above
-- the band is the station head; the subordinate band is the source's तपास / प्रषा / गुन्हे trio.
-- The fourth box the mock drew — “विशेष तपास पथक” with a bare “विशेष” chip and no writer row in
-- any source chart — is removed as chart structure. Nothing is lost from the data: that box never
-- carried an assignment (the source names no विशेष writer, OPEN_QUESTIONS), and every row it could
-- have claimed still renders in the office column.
UPDATE template_versions tv
SET layout = (tv.layout - 'officerBoxWriters') || '{
  "officerBoxes": [
    {"label": "तपास",  "writerDutyTitle": "पोनि.तपास॰रायटर",      "writerRole": "रायटर"},
    {"label": "प्रषा",  "writerDutyTitle": "पोनि.प्रशासन॰रायटर",   "writerRole": "रायटर"},
    {"label": "गुन्हे", "writerDutyTitle": "पोनि.गुन्हे॰रायटर",     "writerRole": "रायटर"}
  ]
}'::jsonb
WHERE tv.template_id = (SELECT template_id FROM chart_templates WHERE name = 'Panchavati Compact v3');

-- Page-3 section split (SEMANTIC 10.md Table 3): leave classes vs court/bandobast classes.
-- group_key values are the source's own column groups; unlisted keys fall into the first section.
UPDATE template_versions tv
SET layout = tv.layout || '{
  "availabilitySections": [
    {"title": "रजा, साप्ताहिक सुट्टी व गैरहजर",
     "groupKeys": ["साप्ताहिक सुट्टी", "किरकोळ रजा", "अर्जित रजा"]},
    {"title": "कोर्ट पैरवी व विशेष क्षेत्रीय बंदोबस्त",
     "groupKeys": ["इतर ड्युटी"]}
  ]
}'::jsonb
WHERE NOT (tv.layout ? 'availabilitySections')
  AND tv.template_id = (SELECT template_id FROM chart_templates WHERE name = 'Panchavati Compact v3');

-- Scan sessions (page 5): fixed session structure per SEMANTIC/10.md Tables 10/11/13
-- (patrol mobile + beat-marshal per session; beat lists are the source rows deduplicated).
-- Fixed configuration (Page1and2 Analysis classification), fill-if-missing only.
UPDATE template_versions tv
SET layout = tv.layout || '{
  "scanSessions": [
    {"session": "01) सकाळ 09:00 ते 15:00", "patrol": "चौकीचे ईन्चार्ज अंमलदार", "beat": "मेरी, फुलेनगर, काटया मारूती, कारंजा, मालेगाव"},
    {"session": "02) दुपार 15:00 ते 21:00", "patrol": "सी.आर., डेल्टा व डी.बी. मोबाईल", "beat": "मेरी, फुलेनगर, काटया मारूती, कारंजा, मालेगाव"},
    {"session": "03) रात्र 21:00 ते 09:00", "patrol": "सी.आर. मोबाईल / डी.बी. मोबाईल", "beat": "मेरी मार्शल, मालेगाव स्टँड मार्शल"}
  ]
}'::jsonb
WHERE NOT (tv.layout ? 'scanSessions')
  AND tv.template_id = (SELECT template_id FROM chart_templates WHERE name = 'Panchavati Compact v3');

-- Beat-marshal posts FOLD INTO their paired chowki on page 2 (approved mock: no standalone
-- marshal block — the marshal's own बंद/charge prints as a `मार्शल:` line inside the chowki's
-- sub-col and its staff rows merge into the same column; every source row still renders, so
-- the no-loss rule holds). Display grouping only (Layer C); chart data untouched.
-- Chowki location code → marshal post location code. सरदार चौकी has no marshal post in the
-- source, so it is absent here and keeps no marshal line — exactly the mock. Fill-if-missing.
UPDATE template_versions tv
SET layout = tv.layout || '{
  "marshalPostForChowki": {
    "CHOWKI_KATYA_MARUTI":    "MARSHAL_KATYA_MARUTI",
    "CHOWKI_KARANJA":         "MARSHAL_KARANJA",
    "CHOWKI_MALEGAON_STAND":  "MARSHAL_MALEGAON_STAND",
    "CHOWKI_PHULENAGAR":      "MARSHAL_PHULENAGAR",
    "CHOWKI_MERI":            "MARSHAL_MERI"
  }
}'::jsonb
WHERE NOT (tv.layout ? 'marshalPostForChowki')
  AND tv.template_id = (SELECT template_id FROM chart_templates WHERE name = 'Panchavati Compact v3');

-- Posts that belong to page 1's कोर्ट, समन्स, वॉरंट व विशेष कक्ष desk instead of a page-2 block.
-- Location-less posts (मोबाईल / सायबर सेल / महिला कक्ष) already fold by having no location; a
-- FIXED_POINT carries one (काळाराम मंदीर गार्ड) but is still a desk post — the approved mock
-- shows six chowki blocks on page 2 and nothing else. Location kinds listed here are display
-- grouping only (Layer C); every source row still renders exactly once. Fill-if-missing.
UPDATE template_versions tv
SET layout = tv.layout || '{"specialDeskLocationKinds": ["FIXED_POINT"]}'::jsonb
WHERE NOT (tv.layout ? 'specialDeskLocationKinds')
  AND tv.template_id = (SELECT template_id FROM chart_templates WHERE name = 'Panchavati Compact v3');
