const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = 3000;

app.use(cors()); // Permissive for development convenience
app.use(express.json());

// ─── Helper: Parse ISO 8601 Duration ────────────────────────────────────────
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

// ─── Helper: Normalize Video URLs to Embed Format ───────────────────────────
function normalizeVideoUrl(rawUrl, baseUrl) {
  if (!rawUrl) return null;
  
  let url = rawUrl;
  // Resolve relative URLs first
  if (url.startsWith('/')) {
    try {
      const base = new URL(baseUrl);
      url = `${base.protocol}//${base.host}${url}`;
    } catch (e) {}
  }

  // Handle YouTube
  if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
    const videoIdMatch = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
    if (videoIdMatch) {
      return `https://www.youtube.com/embed/${videoIdMatch[1]}`;
    }
  }

  // Handle Vimeo (standard URLs to player.vimeo.com)
  if (url.includes('vimeo.com') && !url.includes('player.vimeo.com')) {
    const vimeoIdMatch = url.match(/vimeo\.com(?:\/video)?\/(\d+)/);
    if (vimeoIdMatch) {
      return `https://player.vimeo.com/video/${vimeoIdMatch[1]}`;
    }
  }

  return url;
}

// ─── Helper: Resolve Relative Images ────────────────────────────────────────
function resolveUrl(url, baseUrl) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  try {
    const base = new URL(baseUrl);
    return `${base.protocol}//${base.host}${url.startsWith('/') ? url : '/' + url}`;
  } catch (e) {
    return url;
  }
}

// ─── Core Scraper ────────────────────────────────────────────────────────────
async function scrapeRecipe(url) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
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
        else {
          Object.values(obj).forEach(val => {
            if (typeof val === 'object') traverse(val);
          });
        }
      };
      traverse(json);
    } catch (e) {
      // skip malformed JSON-LD blocks
    }
  });

  if (!recipeData) throw new Error('NO_RECIPE_DATA');

  // Link video if it is just a string reference
  let videoData = recipeData.video;
  if (typeof videoData === 'string' && videoObjects.has(videoData)) {
    videoData = videoObjects.get(videoData);
  }

  // Normalise image – can be string, object, or array of either
  let image = recipeData.image;
  if (Array.isArray(image)) image = image[0];
  if (image && typeof image === 'object') image = image.url || image['@id'] || null;
  image = resolveUrl(image, url);

  // Normalise instructions with media support
  const rawInstructions = recipeData.recipeInstructions || [];
  const instructions = rawInstructions.flatMap((item) => {
    // If it's a simple string
    if (typeof item === 'string') return [{ text: item }];
    
    // If it's a section
    if (item['@type'] === 'HowToSection') {
      return (item.itemListElement || []).map((step) => {
        if (typeof step === 'string') return { text: step };
        
        // Extract step image
        let stepImg = step.image;
        if (Array.isArray(stepImg)) stepImg = stepImg[0];
        if (stepImg && typeof stepImg === 'object') stepImg = stepImg.url || stepImg['@id'] || null;

        return { 
          text: step.text || '',
          image: resolveUrl(stepImg, url),
          video: step.video ? {
            url: normalizeVideoUrl(step.video.contentUrl || step.video.embedUrl || null, url),
            thumbnail: resolveUrl(step.video.thumbnailUrl || null, url)
          } : null
        };
      });
    }

    // It's a single HowToStep
    let stepImg = item.image;
    if (Array.isArray(stepImg)) stepImg = stepImg[0];
    if (stepImg && typeof stepImg === 'object') stepImg = stepImg.url || stepImg['@id'] || null;

    return [{ 
      text: item.text || '',
      image: resolveUrl(stepImg, url),
      video: item.video ? {
        url: normalizeVideoUrl(item.video.contentUrl || item.video.embedUrl || null, url),
        thumbnail: resolveUrl(item.video.thumbnailUrl || null, url)
      } : null
    }];
  });

  return {
    title: recipeData.name || 'Untitled Recipe',
    image: image || null,
    yield: recipeData.recipeYield
      ? Array.isArray(recipeData.recipeYield)
        ? recipeData.recipeYield[0]
        : recipeData.recipeYield
      : null,
    ingredients: recipeData.recipeIngredient || [],
    instructions,
    prepTime: parseIsoDuration(recipeData.prepTime),
    cookTime: parseIsoDuration(recipeData.cookTime),
    video: videoData && typeof videoData === 'object' ? {
      url: normalizeVideoUrl(videoData.contentUrl || videoData.embedUrl || null, url),
      thumbnail: resolveUrl(videoData.thumbnailUrl || null, url)
    } : null
  };
}


// ─── POST /api/parse ─────────────────────────────────────────────────────────
app.post('/api/parse', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A valid URL is required.' });
  }

  try {
    const recipe = await scrapeRecipe(url);
    return res.json(recipe);
  } catch (err) {
    // Axios HTTP errors from the target site
    if (err.response) {
      const status = err.response.status;
      if (status === 401 || status === 402 || status === 403) {
        return res
          .status(422)
          .json({ error: 'This site blocked our request — it may have a paywall.' });
      }
    }

    // Connection / DNS errors
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      return res.status(400).json({ error: 'A valid URL is required.' });
    }

    // No JSON-LD recipe found
    if (err.message === 'NO_RECIPE_DATA') {
      return res
        .status(422)
        .json({ error: 'Could not parse this site. It may not be a recipe page.' });
    }

    console.error('Unexpected error:', err.message);
    return res
      .status(500)
      .json({ error: 'Something went wrong. Please try a different URL.' });
  }
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`✅  JomMasak backend running on http://localhost:${PORT}`);
  });
}

module.exports = app;
