const { scrapeRecipe } = require('./backend/server.js');

async function test() {
  try {
    const recipe = await scrapeRecipe('https://pinchofyum.com/sheet-pan-chicken-pitas');
    console.log(JSON.stringify(recipe, null, 2));
  } catch (e) {
    console.error(e);
  }
}

test();
