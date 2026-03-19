const axios = require('axios');
const cheerio = require('cheerio');

function parseIsoDuration(iso) {
  if (!iso) return null;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  if (hours > 0 && minutes > 0) return `${hours} hr ${minutes} min`;
  if (hours > 0) return `${hours} hr`;
  if (minutes > 0) return `${minutes} min`;
  return null;
}

async function scrapeRecipe(url) {
  const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const $ = cheerio.load(data);
  let recipeData = null;
  const videoObjects = new Map();

  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const json = JSON.parse($(el).html());
      const traverse = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj['@type'] === 'Recipe') recipeData = obj;
        if (obj['@type'] === 'VideoObject') {
          const id = obj['@id'] || obj.url;
          if (id) videoObjects.set(id, obj);
        }
        if (Array.isArray(obj)) obj.forEach(traverse);
        else Object.values(obj).forEach(val => { if (typeof val === 'object') traverse(val); });
      };
      traverse(json);
    } catch (e) {}
  });

  if (!recipeData) throw new Error('NO_RECIPE_DATA');

  const rawInstructions = recipeData.recipeInstructions || [];
  const instructions = rawInstructions.flatMap((item) => {
    if (typeof item === 'string') return [{ text: item }];
    if (item['@type'] === 'HowToSection') {
      return (item.itemListElement || []).map((step) => {
        return { 
          text: step.text || '',
          video: step.video ? { url: step.video.contentUrl || step.video.embedUrl || null } : null
        };
      });
    }
    return [{ 
      text: item.text || '',
      video: item.video ? { url: item.video.contentUrl || item.video.embedUrl || null } : null
    }];
  });

  return instructions;
}

scrapeRecipe('https://pinchofyum.com/sheet-pan-chicken-pitas')
  .then(res => console.log(JSON.stringify(res, null, 2)))
  .catch(console.error);
