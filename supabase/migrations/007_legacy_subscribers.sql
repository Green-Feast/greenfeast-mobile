-- ============================================================
-- GreenFeast — Migration 007: Legacy Subscribers
-- Stores existing subscribers who predate the app.
-- These don't have auth.users records — managed by admin only.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.legacy_subscribers (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT    NOT NULL UNIQUE,
  batch       TEXT    NOT NULL,
  rc          TEXT    NOT NULL DEFAULT 'C' CHECK (rc IN ('C', 'R')),
  name        TEXT    NOT NULL,
  phone       TEXT    NOT NULL,
  address     TEXT    NOT NULL DEFAULT '',
  meal        TEXT    NOT NULL DEFAULT 'Asian Bowl',
  constraints TEXT    NOT NULL DEFAULT '',
  addons      TEXT    NOT NULL DEFAULT '',
  timing      TEXT    NOT NULL DEFAULT '',
  notes       TEXT,
  plan        TEXT    NOT NULL DEFAULT 'Daily',
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'expired')),
  expiry_date DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TRIGGER legacy_subscribers_updated_at
  BEFORE UPDATE ON public.legacy_subscribers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: only service role can access (admin app uses service role key)
ALTER TABLE public.legacy_subscribers ENABLE ROW LEVEL SECURITY;
-- No client-side policies — admin bypasses RLS via service role key

-- ── Seed: existing subscribers ────────────────────────────────────────────────

INSERT INTO public.legacy_subscribers
  (code, batch, rc, name, phone, address, meal, constraints, addons, timing, notes, plan, status, expiry_date)
VALUES
  -- NAMI BATCH
  ('N/C/01','Nami','C','Nitika Shilp Sangam','7610030677','G-961 near balaji market sitapura ricco','Asian Bowl','Extra Paneer','','','','Daily','active','2026-06-15'),
  ('N/C/02','Nami','C','Aanchal','9782212557','Jawahar Nagar','Asian Bowl','No Buddha Avo protein Thai Or anything with tofu','','','Try to send panini or wrap once, alternate','5-day','active','2026-06-10'),
  ('N/C/03','Nami','C','Hiya','9571660678','JNU Jagatpura','Asian Bowl','No peanut, No Pesto, No mushroom','','','','5-day','active','2026-06-08'),
  ('N/C/04','Nami','C','Dr. Nisha','8080475554','Dermatalogy Department Mahatma Gandhi','Asian Bowl','No Bell pepper, No Mushroom, No chilli tofu','','Before 1:00pm','','Daily','active','2026-06-20'),
  ('N/C/05','Nami','C','Dr. Ishika Nanda','8171675992','Dermatalogy Department Mahatma Gandhi','Asian Bowl','No Bell pepper, extra Lettuce','','Before 1:00pm','more panini','Daily','active','2026-06-20'),
  ('N/C/06','Nami','C','Jasleen','9815406442','Skin opd basement, inside mahatma gandhi hospital jaipur','Asian Bowl','No pasta, add quinoa','','Before 1:00pm','Only Tuesday to Friday','5-day','active','2026-06-12'),
  ('N/C/07','Nami','C','Dr. Muskan Jindal','9971414065','Dermatalogy Department Mahatma Gandhi','Asian Bowl','ALLERGIC TO QUINOA','','Before 1:00pm','','Daily','active','2026-06-18'),
  ('N/C/08','Nami','C','Karan Dutt','8628072700','Sector 17 Pratap Nagar','Asian Bowl','Use quinoa','Smoothies','','Only Bowls, no panini/wrap','5-day','active','2026-06-05'),
  ('N/C/09','Nami','C','Dr. Gurusha Kausal','8955652679','MGMC optha','Asian Bowl','NO PANEER, Add tofu','','Before 1:00pm','','Daily','active','2026-06-22'),
  ('N/R/10','Nami','R','Pallavi Bhadu','9782946260','R-50, NRI colony, Pratap nagar, jaipur 302033','Asian Bowl','','','Before 12:00pm','','Daily','paused','2026-06-01'),
  ('N/R/11','Nami','R','Shweta Khari','7290929167','deliver in basement medical college mgh','Asian Bowl','','','','','5-day','active','2026-06-03'),
  ('N/R/12','Nami','R','Abhimanyu Sinha','9172220043','203, MJB Athulyam 1 jagatpura Jaipur','Thai Gen','Mexican, Soya panini, smoky chipotle','','','','Daily','active','2026-06-14'),
  ('N/R/13','Nami','R','Nitika Sood','8094502015','Sdc euro exotica flat no 411 Kaushal nagar sanganer','Asian Bowl','','','','','Daily','active','2026-06-25'),
  ('N/R/14','Nami','R','Roushan','7999651946','Maharana pratap statue circle','Asian Bowl','','','','','Daily','active','2026-06-25'),
  ('N/R/15','Nami','R','Prakriti Jamne','7509751551','E-301, 3rd Floor, AIS Residency, Pratap Nagar, Jaipur','Asian Bowl','','','','','5-day','active','2026-06-25'),
  ('N/R/16','Nami','R','Dr Sarah Chawla','7073777345','MGMC optha','Asian Bowl','','','','','Daily','active','2026-06-25'),

  -- RAHUL BATCH
  ('R/C/01','Rahul','C','Ankit Chitlangiya','9829005037','H1-64 RIICO INDUSTRIAL MANSAROVAR JAIPUR 302020','Asian Bowl','Dressing Outside','Extra protein','Before 1:00pm','','Daily','active','2026-06-19'),
  ('R/C/02','Rahul','C','Deepanshu Sarda','9460102650','196 basant bahar main tonk road gopalpura','Asian Bowl','No Mushrooms, Gluten Free','Extra Protein','','','5-day','active','2026-06-11'),
  ('R/C/03','Rahul','C','Vandana Chandana','9829648888','Sita Bari Near Theme Hotel','Asian Bowl','GLUTEN FREE + 2 dressing 1 non spicy 1 spicy','','','','Daily','active','2026-06-17'),
  ('R/C/04','Rahul','C','Gunjan Khandelwal','9829993434','702, The Legend, Near Hotel Marriot, Durgapura, Jaipur','Asian Bowl','No Mushroom, No Tofu','','','','5-day','active','2026-06-09'),
  ('R/R/05','Rahul','R','Muskan Karnawat','9828899959','92/8, Mahaveer nagar, Durgapura','Asian Bowl','','','Before 1:00pm','','Daily','active','2026-06-04'),
  ('R/R/06','Rahul','R','Arvind Gupta','9829050571','D9-A, D9-B, Lal Bahadur Nagar East, Sector 9, Malviya Nagar','Asian Bowl','2 Meals','','Before 1:00pm','','Daily','active','2026-06-16'),
  ('R/R/07','Rahul','R','Siddharth Pruthi','9784017972','SPP Atelier 55 & 55A parasram Nagar, patrakar colony road, golyawas mansarovar','Asian Bowl','','','','','Daily','active','2026-06-25'),

  -- YASHPAL BATCH
  ('Y/C/01','Yashpal','C','Sonal Mendiratta','9829722323','3ta38 ratan duggar marg jawahar nagar jaipur','Asian Bowl','','EXTRA PROTEIN','','','Daily','active','2026-06-21'),
  ('Y/C/02','Yashpal','C','Rahul Janani','9829160415','Marvy Jewels, 2nd floor, Chaura Raasta, Jaipur','Asian Bowl','No salt, no cheese, no butter, no feta','','','','5-day','active','2026-06-13'),
  ('Y/C/03','Yashpal','C','Rohit Thawrani','9509508345','Shop 39b old atish market MGD market jaipur','Asian Bowl','No carbs, No Quinoa, No wraps','Extra protein','Before 1:30pm','','Daily','active','2026-06-07'),
  ('Y/C/04','Yashpal','C','Pratyush Agarwal','9929407481','102, Geeta Enclave, Vinobha Marg, C-scheme, Jaipur','Peri Peri Panini','','Extra Protein','','Thursdays: peri peri panini; ICE BLOCK','5-day','active','2026-06-23'),
  ('Y/C/05','Yashpal','C','Dr. Charul','9001024212','Gandhi Path','Umami Soba Bowl','No lettuce, add other veggies','','','Quantity Issue','Daily','active','2026-06-18'),
  ('Y/C/06','Yashpal','C','Dr. Sanjana Somani','9873848847','House 227 lane 7 guru jambeshwar nagar Vaishali nagar jaipur','Asian Bowl','Less quinoa, more panini','','','','5-day','active','2026-06-10'),
  ('Y/C/07','Yashpal','C','Utsav Sharma','8302648202','E-106, Shastri nagar near nagar Nigam office','Asian Bowl','NO Quinoa','','Before 1:30pm','','Daily','active','2026-06-15'),
  ('Y/C/08','Yashpal','C','Puru','8955708287','A-29-B, Vivekanand Colony, Naya Khera','Asian Bowl','NO mushroom','','','','5-day','active','2026-06-06'),
  ('Y/R/09','Yashpal','R','Prasant','7023822610','Gurunanak Pura Tilak nagar','Asian Bowl','','','','','Daily','active','2026-06-25'),
  ('Y/R/10','Yashpal','R','Raghav Agarwal','9782741432','Agarwal & company, 1307, kedia bhawan, gopal ji ka rasta, johri bazar','Asian Bowl','','','','','Daily','active','2026-06-25'),
  ('Y/R/11','Yashpal','R','Dr. Gaurav','9929471752','ExcelCare Hospital, 103, sanjay nagar, joshi marg, kalwar road, jhotwara','Asian Bowl','','','','Tuesday off','Daily','active','2026-06-25'),
  ('Y/R/12','Yashpal','R','Arihant Dhadda','9828018090','Kalki showroom near teenmurti circle','Umami Soba Bowl','','','','','Daily','active','2026-06-25'),

  -- SANTU BATCH
  ('S/C/01','Santu','C','Aditii Sisodiya','9820415361','SMS stadium / Holiday Inn','Asian Bowl','Less carbs, more veggies, no beetroot, no chickpeas, no tofu','','Around 8:00pm','Meal yet to be confirmed','Daily','active','2026-06-20'),
  ('S/C/02','Santu','C','Dr. Shivam','9992787315','Jain Ent Hospital Lal Kothi','Asian Bowl','No Papaya, No corn','','','','Daily','active','2026-06-14'),
  ('S/C/03','Santu','C','Dr. Sidhant','8225000777','','Asian Bowl','Gluten Free','','','','5-day','active','2026-06-11'),
  ('S/C/04','Santu','C','Dr. Ashray Jain','6387668569','Jain Ent Hospital Lal Kothi','Tropical Fruit Salad','','Extra spicy smoothie','','Thursday - tropical fruit + smoothie','Daily','active','2026-06-19'),
  ('S/C/05','Santu','C','Anant','8619957997','Ruby 302, Somdatt Apartments, Civil Lines, Hawa Sadak, Jaipur','Mexican Fiesta Bowl','More dressing','','','','Daily','active','2026-06-16'),
  ('S/C/06','Santu','C','Surabhi Pannu','9636456512','Bhandari House Govindpuri c-38 hawa sadak jaipur','Asian Bowl','DAIRY FREE ALLERGEN','','Before 12:00pm','','5-day','active','2026-06-08'),
  ('S/C/07','Santu','C','Ashwin Ji','7021139318','Shop 47, Gangaram Nagar, New Aatish Market, Shanthi Nagar','Asian Bowl','Less Carbs, No tofu, No Quinoa budha','Extra protein','','','Daily','active','2026-06-22'),
  ('S/C/08','Santu','C','Akash Chauhan','8233186472','256, Vardhman Nagar-A, Ajmer Road, Jaipur 302019','Asian Bowl','No Pasta, No Mushroom, No Noodles','','','','5-day','active','2026-06-17'),
  ('S/C/09','Santu','C','Giri Raj','7568387373','4/487, near sethi departmental store, jawarhar nagar','Asian Bowl','Extra Paneer, Extra Corn','Avo Protein','','','Daily','active','2026-06-12'),
  ('S/R/10','Santu','R','Bharti Maheshwari','8742067974','Partani Clinic 175 no gali no 7 barkat nagar 302015','Asian Bowl','','','','','Daily','active','2026-06-25'),
  ('S/R/11','Santu','R','Dr. Sudhanshu','7415010737','AMRC Park Hospital Kiran Path','Asian Bowl','','','Before 1:15pm','','Daily','active','2026-06-25'),
  ('S/R/12','Santu','R','Rishabh Rao','7976287022','C216/g1, ss apartment, nirman nagar','Panini','','','','','Daily','active','2026-06-25'),

  -- EVENING BATCH
  ('E/C/01','Evening','C','Praveen Vijayvegiya','9982613131','1st floor, g9, jalsa building, green street, lal bahdur nagar, jln marg','Asian Bowl','EXTRA Protein','','Before 1:30pm','','Daily','active','2026-06-20'),
  ('E/C/02','Evening','C','Shubham Gangwal','9597445822','K-19, K Block Mahaveer Nagar, Tonk Road, Jaipur-302018','Asian Bowl','NO AVOCADO','2 Egg and 100gm Tofu (alternating days)','','','5-day','active','2026-06-13'),
  ('E/C/03','Evening','C','Shivani Puri','9982511715','K-29, Trinity Kartikeya, Mahaveer Nagar, Durga Pura','Asian Bowl','Chipotle dressing + Peanut dressing, No avo protein','EXTRA PROTEIN','','Give at end','Daily','active','2026-06-09'),
  ('E/C/04','Evening','C','Aman Dua','7597092777','1-GHA-9, Jawahar Nagar, Sector-1, behind bank of baroda','Quinoa Buddha Bowl','No beetroot, No sweet potato, add 100gm paneer','2 Meals','','','Daily','active','2026-06-18'),
  ('E/R/05','Evening','R','Mukesh Rela','9829066110','new address','Asian Bowl','','','','','Daily','active','2026-06-25'),
  ('E/R/06','Evening','R','Harshit Sachdeva','9660612829','Behind LBS College house 75 Shanti Path Tilak nagar','Asian Bowl','','','','','Daily','active','2026-06-25')
ON CONFLICT (code) DO NOTHING;
