# Foundry VTT - 5e Companion Importer

A module for **Foundry VTT** (dnd5e system) that allows seamless integration with the **5e Companion App**.

## Features

### 📥 Import from 5e Companion App
Import characters directly from `.cah` files exported from the mobile app.
*   **Attributes:** Abilities, Saving Throws, Skills (including Expertise).
*   **Combat:** HP, AC, Speed, Initiative.
*   **Details:** Background, Race, Alignment, XP.
*   **Inventory:** Weapons, Armor, Equipment, Currency.
*   **Spells:** Imports spells and slots. Checks compendiums first, falls back to placeholders with links to 5e.tools.

### 📤 Export to 5e Companion App
Export your Foundry VTT actors back to `.cah` format to use them on your mobile device.

### 📄 Export to PDF
Generate a **Fillable PDF Character Sheet** (Standard 5e Layout) directly from your actor sheet.
*   Automatically maps all stats, skills, and items.
*   Intelligent spellcasting ability detection based on Class.
*   Calculates modifiers if they aren't explicitly stored.

## Usage

### Importing
1.  Open the **Actors Directory** in Foundry.
2.  Click the **"Import 5e Companion"** button at the bottom.
3.  Select your `.cah` file and click Import.

### Exporting
1.  Open any **Character Sheet**.
2.  Click **"Export to CAH"** in the window header to get a file for the mobile app.
3.  Click **"Export to PDF"** to download a filled PDF character sheet.

## Installation
1.  In Foundry VTT, go to **Add-on Modules** -> **Install Module**.
2.  Paste the following Manifest URL:
    `https://github.com/Shinigallo/foundry-5e-companion-importer/releases/latest/download/module.json`
3.  Click **Install**.

## Credits
*   PDF Export powered by `pdf-lib`.
*   Fillable PDF Template based on standard 5e designs.
