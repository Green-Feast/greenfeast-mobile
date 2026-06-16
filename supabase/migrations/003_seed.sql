-- ============================================================
-- GreenFeast — Migration 003: Seed Data
-- Run AFTER 002_rls.sql
-- All prices stored in PAISE (₹1 = 100 paise)
-- ============================================================


-- ── Plans ────────────────────────────────────────────────────────────────────
INSERT INTO public.plans (id, name, meals_total, days_per_week, base_price) VALUES
  ('trial',   '5-Meal Trial',  5,  5, 149900),
  ('plan15',  '15-Meal Plan',  15, 3, 405000),
  ('plan30',  '30-Meal Plan',  30, 6, 749900);


-- ── Batches ───────────────────────────────────────────────────────────────────
-- Not seeded. Batches are created manually via the admin app as delivery
-- partners are onboarded. Each batch maps to a delivery run (person + time slot).


-- ── Meal Templates ────────────────────────────────────────────────────────────

-- Bowls — ₹329 each
INSERT INTO public.meal_templates (id, name, category, description, price, kcal, protein, carbs, fat, tags) VALUES
  ('thai-zen-bowl',
   'Thai Zen Bowl', 'bowl',
   'Light and refreshing Thai-inspired bowl with fresh vegetables and jasmine rice',
   32900, 420, 18.0, 52.0, 12.0,
   ARRAY['Gluten-Free', 'Vegan']),

  ('italian-harvest-bowl',
   'Italian Harvest Bowl', 'bowl',
   'Sun-dried tomatoes, roasted zucchini, olives, and farro in a herb vinaigrette',
   32900, 480, 22.0, 58.0, 14.0,
   ARRAY['Vegetarian']),

  ('mexican-fiesta-bowl',
   'Mexican Fiesta Bowl', 'bowl',
   'Black beans, corn, avocado, pico de gallo over cilantro-lime rice',
   32900, 510, 24.0, 62.0, 13.0,
   ARRAY['Vegan', 'Gluten-Free']),

  ('mediterranean-mezze-bowl',
   'Mediterranean Mezze Bowl', 'bowl',
   'Hummus, tabbouleh, roasted peppers, and warm pita over couscous',
   32900, 460, 20.0, 55.0, 15.0,
   ARRAY['Vegetarian']),

  ('japanese-umami-bowl',
   'Japanese Umami Bowl', 'bowl',
   'Edamame, shredded cabbage, pickled ginger, and brown rice with miso dressing',
   32900, 440, 19.0, 50.0, 11.0,
   ARRAY['Gluten-Free', 'Vegan']),

  ('indian-spice-bowl',
   'Indian Spice Bowl', 'bowl',
   'Spiced chickpeas, saffron rice, cucumber raita, and pickled onions',
   32900, 490, 21.0, 60.0, 12.0,
   ARRAY['Vegan', 'Jain', 'Gluten-Free']),

  ('korean-bibimbap-bowl',
   'Korean Bibimbap Bowl', 'bowl',
   'Seasoned mixed vegetables, gochujang sauce, and steamed rice',
   32900, 470, 23.0, 57.0, 13.0,
   ARRAY['Gluten-Free', 'Vegan']);


-- Wraps — ₹299 each
INSERT INTO public.meal_templates (id, name, category, description, price, kcal, protein, carbs, fat, tags) VALUES
  ('smoky-chipotle-wrap',
   'Smoky Chipotle Wrap', 'wrap',
   'Chipotle-spiced paneer, roasted peppers, and slaw in a whole-wheat tortilla',
   29900, 380, 20.0, 42.0, 14.0,
   ARRAY['Vegetarian']),

  ('bbq-protein-wrap',
   'BBQ Protein Wrap', 'wrap',
   'BBQ-glazed soya chunks, caramelised onions, and crispy lettuce',
   29900, 410, 28.0, 38.0, 15.0,
   ARRAY['Vegan']),

  ('mediterranean-falafel-wrap',
   'Mediterranean Falafel Wrap', 'wrap',
   'Crispy baked falafel, tzatziki, and tabbouleh in a spinach wrap',
   29900, 360, 16.0, 45.0, 12.0,
   ARRAY['Vegan']),

  ('thai-peanut-wrap',
   'Thai Peanut Wrap', 'wrap',
   'Rice noodles, cucumber, carrot, fresh herbs, and peanut-lime dressing',
   29900, 390, 18.0, 44.0, 16.0,
   ARRAY['Vegan', 'Gluten-Free']);


-- Salads — ₹299 each
INSERT INTO public.meal_templates (id, name, category, description, price, kcal, protein, carbs, fat, tags) VALUES
  ('greek-quinoa-salad',
   'Greek Quinoa Salad', 'salad',
   'Quinoa, kalamata olives, cherry tomatoes, cucumber, and feta with lemon herb dressing',
   29900, 320, 14.0, 35.0, 12.0,
   ARRAY['Vegetarian', 'Gluten-Free']),

  ('asian-sesame-salad',
   'Asian Sesame Salad', 'salad',
   'Shredded cabbage, edamame, mango, and toasted sesame with ginger-soy vinaigrette',
   29900, 280, 12.0, 32.0, 10.0,
   ARRAY['Vegan', 'Gluten-Free']),

  ('caesar-power-salad',
   'Caesar Power Salad', 'salad',
   'Romaine, whole-grain croutons, parmesan crisps, and yoghurt Caesar dressing',
   29900, 340, 16.0, 28.0, 14.0,
   ARRAY['Vegetarian']),

  ('moroccan-chickpea-salad',
   'Moroccan Chickpea Salad', 'salad',
   'Harissa-spiced chickpeas, roasted sweet potato, raisins, and mint-yoghurt dressing',
   29900, 310, 15.0, 40.0, 9.0,
   ARRAY['Vegan', 'Gluten-Free']);


-- Toasts — ₹279 each
INSERT INTO public.meal_templates (id, name, category, description, price, kcal, protein, carbs, fat, tags) VALUES
  ('avocado-smash-toast',
   'Avocado Smash Toast', 'toast',
   'Creamy smashed avocado, cherry tomatoes, and everything seasoning on sourdough',
   27900, 290, 10.0, 32.0, 15.0,
   ARRAY['Vegan']),

  ('egg-white-toast',
   'Egg White Toast', 'toast',
   'Fluffy egg whites, sautéed spinach, and chilli flakes on whole-grain toast',
   27900, 240, 18.0, 28.0, 7.0,
   ARRAY['Vegetarian', 'Gluten-Free']);


-- Smoothies — ₹149 / ₹199
INSERT INTO public.meal_templates (id, name, category, description, price, kcal, protein, carbs, fat, tags) VALUES
  ('green-detox-smoothie',
   'Green Detox Smoothie', 'smoothie',
   'Spinach, cucumber, green apple, ginger, and coconut water',
   14900, 180, 6.0, 32.0, 3.0,
   ARRAY['Vegan', 'Gluten-Free']),

  ('tropical-protein-smoothie',
   'Tropical Protein Smoothie', 'smoothie',
   'Mango, pineapple, banana, plant protein, and almond milk',
   19900, 220, 15.0, 35.0, 4.0,
   ARRAY['Vegan', 'Gluten-Free']),

  ('berry-blast-smoothie',
   'Berry Blast Smoothie', 'smoothie',
   'Mixed berries, pomegranate, chia seeds, and oat milk',
   19900, 190, 8.0, 38.0, 2.0,
   ARRAY['Vegan', 'Gluten-Free']);


-- ── Add-ons ───────────────────────────────────────────────────────────────────
INSERT INTO public.addons (id, name, description, price_per_meal) VALUES
  ('smoothie',      'Smoothie',           NULL,                        6000),
  ('exotic-fruits', 'Exotic Cut Fruits',  NULL,                        5000),
  ('cheese',        'Cheese',             'Feta / Parmesan / Cheddar', 3000);
