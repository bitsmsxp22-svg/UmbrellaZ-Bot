import { makeNiche, type NicheResearch, type ResearchItem } from './trends';

/**
 * Conceitos de referência usados quando a pesquisa ao vivo no Adobe Stock não está disponível
 * (modo simulação, sem internet ou bloqueio temporário). São temas "evergreen" que historicamente
 * vendem bem — descrições genéricas, não cópias de imagens específicas.
 */
const BUILTIN: Record<string, string[]> = {
  'business teamwork office': [
    'Diverse business team brainstorming in a bright modern office',
    'Smiling businesswoman leading a meeting with colleagues',
    'Coworkers stacking hands together as a symbol of teamwork',
    'Business people shaking hands after a successful deal',
    'Young entrepreneur working on laptop in open space office',
    'Team analyzing charts on a large screen in a meeting room',
    'Confident business leader portrait in a glass office',
    'Colleagues celebrating success with high five at work',
  ],
  'artificial intelligence technology': [
    'Artificial intelligence digital brain with glowing neural network',
    'Businessman touching futuristic holographic AI interface',
    'Humanoid robot hand and human hand reaching toward each other',
    'Data center server room with blue neon lights',
    'Abstract circuit board background with flowing light data',
    'Programmer working with AI code on multiple monitors at night',
    'Futuristic city with connected smart network lines',
    'Chatbot assistant concept on a smartphone screen',
  ],
  'abstract background': [
    'Soft pastel gradient background with smooth waves',
    'Dark blue abstract background with glowing particles',
    'Minimal beige textured paper background',
    'Colorful fluid liquid marble texture',
    'Luxury gold and black abstract geometric background',
    'Bokeh lights background with warm golden tones',
    'Green leaves shadows on white wall background',
    'Holographic iridescent foil texture background',
  ],
  'healthy food': [
    'Healthy salad bowl with avocado quinoa and fresh vegetables top view',
    'Assortment of fresh fruits and vegetables on a wooden table',
    'Smoothie bowls with berries and granola flat lay',
    'Balanced diet meal prep containers on kitchen counter',
    'Woman preparing a healthy breakfast in a bright kitchen',
    'Mediterranean diet ingredients with olive oil and fish',
    'Vegan buddha bowl with chickpeas and colorful vegetables',
    'Fresh green juice with ingredients on marble surface',
  ],
  'renewable energy sustainability': [
    'Solar panels field at sunset with clear sky',
    'Wind turbines on green hills under blue sky',
    'Engineer inspecting solar panels on a rooftop',
    'Electric car charging at a modern charging station',
    'Hands holding a young green plant sprouting from soil',
    'Eco friendly city with green buildings and clean energy',
    'Recycling bins with sorted waste for sustainability',
    'Green energy concept with light bulb and leaves',
  ],
  'healthcare doctor': [
    'Friendly doctor talking with a patient in a modern clinic',
    'Medical team of doctors and nurses in a hospital corridor',
    'Doctor holding a stethoscope close up',
    'Telemedicine video consultation on a laptop at home',
    'Scientist working with microscope in a bright laboratory',
    'Nurse caring for a senior patient in hospital room',
    'Healthcare technology concept with digital medical icons',
    'Pharmacist organizing medicines on pharmacy shelves',
  ],
  'finance money investment': [
    'Stock market trading chart on multiple screens',
    'Growing stacks of coins with a young plant symbolizing investment',
    'Businessman analyzing financial report with calculator',
    'Couple planning family budget at home with laptop',
    'Cryptocurrency and digital finance concept background',
    'Piggy bank with coins for savings concept',
    'Financial advisor explaining investment plan to clients',
    'Rising graph arrow over city skyline for economic growth',
  ],
  'nature landscape': [
    'Majestic mountain range at sunrise with morning fog',
    'Tropical beach with turquoise water and palm trees',
    'Autumn forest path with golden leaves',
    'Aerial view of a winding river through green valley',
    'Starry night sky over a calm lake',
    'Lavender field at sunset in the countryside',
    'Waterfall in a lush rainforest',
    'Snowy mountain peaks reflected in an alpine lake',
  ],
  'remote work home office': [
    'Woman working from home on laptop in a cozy living room',
    'Minimal home office desk setup with plants and natural light',
    'Man on a video call with colleagues from his home office',
    'Freelancer working with laptop and coffee at kitchen table',
    'Hybrid work concept with laptop and calendar on desk',
    'Parent working from home while child plays nearby',
    'Digital nomad working with laptop in a cafe',
    'Top view of workspace with laptop notebook and coffee',
  ],
  'cybersecurity data': [
    'Cyber security concept with digital padlock on circuit background',
    'Hacker silhouette in hoodie with binary code',
    'Data protection shield over a laptop keyboard',
    'Security analyst monitoring network threats in operations center',
    'Fingerprint biometric authentication scanning concept',
    'Cloud computing security network connections',
    'Password login screen with protection icons',
    'Global data network with glowing connections around the earth',
  ],
  halloween: [
    'Carved jack o lantern pumpkins glowing at night',
    'Halloween party table with spooky treats and candles',
    'Children in cute halloween costumes trick or treating',
    'Spooky haunted house under full moon',
    'Halloween background with pumpkins bats and copy space',
    'Witch hat and cauldron with magical smoke',
  ],
  'thanksgiving dinner': [
    'Family gathering around thanksgiving dinner table with roasted turkey',
    'Autumn harvest table with pumpkins and seasonal food',
    'Friends toasting at a cozy thanksgiving meal',
    'Thanksgiving table setting with candles and fall leaves',
    'Pumpkin pie and autumn decor on rustic wooden table',
  ],
  'black friday shopping': [
    'Black friday sale concept with shopping bags on dark background',
    'Happy woman holding shopping bags in a mall',
    'Online shopping with credit card and laptop',
    'Gift boxes with red ribbons on black background',
    'Shopping cart with boxes for ecommerce sale',
  ],
  'christmas holiday': [
    'Cozy christmas living room with decorated tree and fireplace',
    'Family opening christmas presents at home',
    'Christmas background with fir branches ornaments and copy space',
    'Hot cocoa with marshmallows by the window in winter',
    'Wrapped christmas gifts under the tree with warm lights',
    'Snowy village at night with festive lights',
  ],
  'new year celebration': [
    'Friends celebrating new year with champagne and sparklers',
    'Fireworks over city skyline at midnight',
    'Golden new year background with confetti and bokeh',
    'Happy couple toasting at a new year party',
  ],
  'valentines day love': [
    'Romantic couple embracing at sunset',
    'Red hearts and roses background for valentines day',
    'Gift box with heart and flowers on pink background',
  ],
  'easter holiday': [
    'Colorful easter eggs in a basket with spring flowers',
    'Children on an easter egg hunt in the garden',
    'Easter bunny decoration with pastel background',
  ],
  'mothers day': [
    'Mother and daughter hugging with flowers',
    'Mothers day breakfast in bed surprise',
    'Bouquet of tulips and gift box for mothers day',
  ],
  'fathers day': [
    'Father and son playing together in the park',
    'Fathers day gift with tie and card',
    'Happy dad carrying daughter on shoulders outdoors',
  ],
  'summer vacation beach': [
    'Family enjoying summer vacation on the beach',
    'Tropical cocktail on the sand by the sea',
    'Beach accessories flat lay with sunglasses and hat',
  ],
  'back to school': [
    'Kids with backpacks going back to school',
    'School supplies flat lay on colorful background',
    'Teacher and students in a bright classroom',
  ],
  'st patricks day': [
    'Green clover leaves background for st patricks day',
    'Friends celebrating st patricks day with green decorations',
  ],
};

function toItems(titles: string[]): ResearchItem[] {
  return titles.map((title, i) => ({ rank: i + 1, id: `builtin-${i + 1}`, title, url: '', keywords: [] }));
}

/** Gera conceitos genéricos para nichos personalizados que não têm dados de reserva. */
function genericConcepts(query: string): string[] {
  const q = query.trim();
  return [
    `${q} concept with modern clean composition`,
    `Professional ${q} scene with natural light`,
    `${q} background with copy space`,
    `People engaged in ${q} in an authentic setting`,
    `Close up detail of ${q}`,
    `Top view flat lay of ${q} elements`,
  ];
}

export function builtinNiche(query: string, extra: Partial<NicheResearch> = {}): NicheResearch {
  const titles = BUILTIN[query.toLowerCase().trim()] ?? genericConcepts(query);
  return makeNiche(query, toItems(titles), 'builtin', extra);
}
