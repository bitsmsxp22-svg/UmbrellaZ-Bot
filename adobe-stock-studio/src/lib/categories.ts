/** Categorias oficiais do Adobe Stock (coluna "Category" do CSV). */
export interface AdobeCategory {
  id: number;
  name: string;
  pt: string;
  hints: string[];
}

export const ADOBE_CATEGORIES: AdobeCategory[] = [
  { id: 1, name: 'Animals', pt: 'Animais', hints: ['animal', 'dog', 'cat', 'pet', 'puppy', 'kitten', 'bird', 'wildlife', 'horse', 'fish', 'insect', 'zoo'] },
  { id: 2, name: 'Buildings and Architecture', pt: 'Edifícios e arquitetura', hints: ['building', 'architecture', 'house', 'interior', 'skyline', 'skyscraper', 'facade', 'kitchen', 'living room', 'real estate', 'apartment'] },
  { id: 3, name: 'Business', pt: 'Negócios', hints: ['business', 'office', 'meeting', 'corporate', 'teamwork', 'team', 'finance', 'money', 'investment', 'startup', 'marketing', 'businessman', 'businesswoman', 'workplace', 'coworking', 'remote work', 'stock market'] },
  { id: 4, name: 'Drinks', pt: 'Bebidas', hints: ['coffee', 'drink', 'wine', 'beer', 'cocktail', 'tea', 'juice', 'smoothie', 'beverage', 'latte'] },
  { id: 5, name: 'The Environment', pt: 'Meio ambiente', hints: ['environment', 'sustainability', 'sustainable', 'climate', 'eco', 'ecology', 'renewable', 'solar', 'wind turbine', 'recycling', 'green energy', 'pollution', 'carbon'] },
  { id: 6, name: 'States of Mind', pt: 'Estados de espírito', hints: ['emotion', 'stress', 'happy', 'happiness', 'mental health', 'calm', 'anxiety', 'depression', 'mindfulness', 'meditation', 'wellbeing', 'lonely'] },
  { id: 7, name: 'Food', pt: 'Comida', hints: ['food', 'meal', 'fruit', 'vegetable', 'dessert', 'cooking', 'salad', 'pizza', 'bread', 'breakfast', 'healthy eating', 'vegan', 'cuisine'] },
  { id: 8, name: 'Graphic Resources', pt: 'Recursos gráficos', hints: ['background', 'texture', 'pattern', 'abstract', 'gradient', 'wallpaper', 'banner', 'mockup', 'backdrop', 'bokeh', 'template', 'frame', 'border'] },
  { id: 9, name: 'Hobbies and Leisure', pt: 'Passatempos e lazer', hints: ['hobby', 'leisure', 'gaming', 'music', 'reading', 'gardening', 'camping', 'painting', 'craft', 'picnic', 'party'] },
  { id: 10, name: 'Industry', pt: 'Indústria', hints: ['industry', 'industrial', 'factory', 'construction', 'manufacturing', 'warehouse', 'logistics', 'engineer', 'machinery', 'oil', 'mining'] },
  { id: 11, name: 'Landscapes', pt: 'Paisagens', hints: ['landscape', 'mountain', 'beach', 'sunset', 'sunrise', 'forest', 'ocean', 'lake', 'valley', 'desert', 'waterfall', 'nature', 'scenery'] },
  { id: 12, name: 'Lifestyle', pt: 'Estilo de vida', hints: ['lifestyle', 'family', 'home', 'relaxing', 'couple', 'friends', 'weekend', 'cozy', 'daily life'] },
  { id: 13, name: 'People', pt: 'Pessoas', hints: ['people', 'portrait', 'woman', 'man', 'child', 'kid', 'senior', 'girl', 'boy', 'person', 'face', 'smiling'] },
  { id: 14, name: 'Plants and Flowers', pt: 'Plantas e flores', hints: ['flower', 'flowers', 'plant', 'leaf', 'leaves', 'botanical', 'floral', 'rose', 'tree', 'succulent', 'garden'] },
  { id: 15, name: 'Culture and Religion', pt: 'Cultura e religião', hints: ['culture', 'religion', 'festival', 'christmas', 'halloween', 'holiday', 'easter', 'diwali', 'ramadan', 'thanksgiving', 'new year', 'carnival', 'tradition', 'valentine'] },
  { id: 16, name: 'Science', pt: 'Ciência', hints: ['science', 'laboratory', 'medicine', 'medical', 'research', 'dna', 'healthcare', 'doctor', 'hospital', 'chemistry', 'biology', 'microscope', 'space', 'astronomy'] },
  { id: 17, name: 'Social Issues', pt: 'Questões sociais', hints: ['diversity', 'poverty', 'equality', 'protest', 'inclusion', 'charity', 'volunteer', 'refugee', 'homeless', 'donation'] },
  { id: 18, name: 'Sports', pt: 'Esportes', hints: ['sport', 'sports', 'fitness', 'gym', 'football', 'soccer', 'running', 'yoga', 'workout', 'basketball', 'tennis', 'cycling', 'athlete'] },
  { id: 19, name: 'Technology', pt: 'Tecnologia', hints: ['technology', 'ai', 'artificial intelligence', 'computer', 'digital', 'cyber', 'cybersecurity', 'data', 'robot', 'smartphone', 'network', 'software', 'coding', 'futuristic', 'blockchain', 'hologram'] },
  { id: 20, name: 'Transport', pt: 'Transporte', hints: ['car', 'transport', 'transportation', 'vehicle', 'train', 'airplane', 'truck', 'electric car', 'bicycle', 'traffic', 'road', 'ship'] },
  { id: 21, name: 'Travel', pt: 'Viagem', hints: ['travel', 'vacation', 'tourism', 'luggage', 'hotel', 'trip', 'tourist', 'passport', 'resort', 'journey', 'adventure'] },
];

export function categoryName(id: number): string {
  const c = ADOBE_CATEGORIES.find((cat) => cat.id === id);
  return c ? `${c.id} · ${c.pt}` : String(id);
}

/** Escolhe a categoria com mais palavras-chave em comum com o texto. */
export function classifyCategory(text: string, fallback = 8): number {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `;
  let best = { id: fallback, score: 0 };
  for (const cat of ADOBE_CATEGORIES) {
    let score = 0;
    for (const hint of cat.hints) {
      const hits = haystack.match(new RegExp(`(?<= )${hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?= )`, 'g'))?.length ?? 0;
      score += hits * (hint.includes(' ') ? 2 : 1);
    }
    if (score > best.score) best = { id: cat.id, score };
  }
  return best.id;
}
