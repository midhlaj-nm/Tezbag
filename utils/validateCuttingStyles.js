function validateCuttingStyles(categoryDoc, cutStyles) {
  const styles = Array.isArray(cutStyles) ? cutStyles : cutStyles ? [cutStyles] : [];

  if (styles.length === 0) {
    throw `Please select at least one cutting style or 'None' for ${categoryDoc.name} products.`;
  }

  if (styles.includes('None') && styles.length > 1) {
    throw `If 'None' is selected, no other cutting styles should be selected.`;
  }

  const allowedStyles = categoryDoc.name === 'Meat'
    ? ["None", "Curry Cut", "Biriyani Cut", "Soup Cut", "Bone Cut", "Boneless Cut", "Chops", "Liver", "Steak Cut", "Heart", "Keema (Minced)", "Dry Fry Cut", "Neck Cut", "Full Chicken"]
    : ["None", "Whole Fish", "Sliced Cut", "Steak Cut", "Curry Cut", "Fillet Cut", "Head & Tail Removed", "Butterfly Cut", "Finger Cut"];

  const invalidStyles = styles.filter(style => !allowedStyles.includes(style));
  if (invalidStyles.length > 0) {
    throw `Invalid cutting styles for ${categoryDoc.name}: ${invalidStyles.join(', ')}`;
  }

  return styles;
}

module.exports = validateCuttingStyles;
