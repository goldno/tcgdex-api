require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const syncPrices     = require('./src/priceSync');
const syncCards      = require('./src/syncCards');
const computeMetrics = require('./src/computeMetrics');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/cards',     require('./routes/cards'));
app.use('/cards',     require('./routes/prices'));
app.use('/analytics', require('./routes/analytics'));

// Daily price sync at 21:00 UTC — 1 hour after TCGCSV updates its prices
cron.schedule('0 21 * * *', () => {
  syncPrices().catch(console.error);
});

// Daily metrics computation at 22:00 UTC — after prices are synced
cron.schedule('0 22 * * *', () => {
  computeMetrics().catch(console.error);
});

// Weekly card discovery every Monday at 22:30 UTC
cron.schedule('30 22 * * 1', () => {
  syncCards().catch(console.error);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`TCGDex API running on port ${PORT}`));
