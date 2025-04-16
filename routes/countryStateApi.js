// routes/api.js or wherever you're managing API routes
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Endpoint to fetch states by country
router.get('/states/:country', (req, res) => {
  const country = req.params.country;
  const filePath = path.join(__dirname, '../countriesWithStates.json');

  console.log(`📍 API Hit: /states/${country}`);
  console.log(`📄 Looking for file at: ${filePath}`);

  fs.readFile(filePath, 'utf-8', (err, data) => {
    if (err) {
      console.error('❌ Error reading JSON file:', err.message);
      return res.status(500).json({ error: 'Failed to read states data' });
    }

    console.log('✅ File read successfully');

    let countries;
    try {
      countries = JSON.parse(data);
    } catch (parseErr) {
      console.error('❌ JSON parse error:', parseErr.message);
      return res.status(500).json({ error: 'Invalid JSON format' });
    }

    const states = countries[country];

    if (!states) {
      console.warn(`⚠️ No states found for country: "${country}"`);
      return res.json([]); // Return empty array for unknown countries
    }

    console.log(`✅ States found for "${country}":`, states.length);
    res.json(states);
  });
});

module.exports = router;
