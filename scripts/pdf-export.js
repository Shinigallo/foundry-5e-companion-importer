const PDF_TEMPLATE_PATH = "modules/foundry-5e-companion-importer/templates/5E_CharacterSheet_Fillable.pdf";

export async function exportToPdf(actor) {
  try {
    ui.notifications.info("Generating PDF, please wait...");

    // 1. Load PDF Template
    const existingPdfBytes = await fetch(PDF_TEMPLATE_PATH).then(res => res.arrayBuffer());
    const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
    const form = pdfDoc.getForm();

    // 2. Prepare Data
    const data = actor.system;
    const items = actor.items;
    
    // --- BASIC INFO ---
    setField(form, 'CharacterName', actor.name);
    setField(form, 'PlayerName', game.user.name); // Or data.details.notes
    setField(form, 'Background', (data.details.background || "").replace(/_/g, " ").titleCase());
    
    const race = items.find(i => i.type === "race");
    if (race) setField(form, 'Race ', race.name);

    setField(form, 'Alignment', (data.details.alignment || "").replace(/_/g, " ").titleCase());
    setField(form, 'XP', data.details.xp.value.toString());

    // Classes
    const classes = items.filter(i => i.type === "class");
    const classLevelStr = classes.map(c => `${c.name} ${c.system.levels}`).join(" / ");
    setField(form, 'ClassLevel', classLevelStr);
    
    const totalLevel = classes.reduce((acc, c) => acc + c.system.levels, 0);

    // --- ABILITIES & SAVES ---
    const abilities = {
      'str': { name: 'Strength', label: 'STR', modField: 'STRmod', saveBox: 'Check Box 11', saveField: 'ST Strength' },
      'dex': { name: 'Dexterity', label: 'DEX', modField: 'DEXmod ', saveBox: 'Check Box 18', saveField: 'ST Dexterity' },
      'con': { name: 'Constitution', label: 'CON', modField: 'CONmod', saveBox: 'Check Box 19', saveField: 'ST Constitution' },
      'int': { name: 'Intelligence', label: 'INT', modField: 'INTmod', saveBox: 'Check Box 20', saveField: 'ST Intelligence' },
      'wis': { name: 'Wisdom', label: 'WIS', modField: 'WISmod', saveBox: 'Check Box 21', saveField: 'ST Wisdom' },
      'cha': { name: 'Charisma', label: 'CHA', modField: 'CHamod', saveBox: 'Check Box 22', saveField: 'ST Charisma' }
    };

    for (const [key, conf] of Object.entries(abilities)) {
      const abil = data.abilities[key];
      // Fallback calculation if system hasn't derived it yet
      const mod = (abil.mod !== undefined) ? abil.mod : Math.floor((abil.value - 10) / 2);
      
      setField(form, conf.label, abil.value.toString());
      setField(form, conf.modField, (mod >= 0 ? "+" : "") + mod);
      
      // Save
      // Calculate save manually if missing (mod + prof if proficient)
      let saveMod = abil.save;
      if (saveMod === undefined) {
          saveMod = mod + (abil.proficient ? (data.attributes.prof || 2) : 0);
      }
      setField(form, conf.saveField, (saveMod >= 0 ? "+" : "") + saveMod);
      
      if (abil.proficient) {
         setCheckbox(form, conf.saveBox, true);
      }
    }

    // --- SKILLS ---
    const skillsMap = {
      'acr': { name: 'Acrobatics', box: 'Check Box 23' },
      'ani': { name: 'Animal', box: 'Check Box 24' },
      'arc': { name: 'Arcana', box: 'Check Box 25' },
      'ath': { name: 'Athletics', box: 'Check Box 26' },
      'dec': { name: 'Deception ', box: 'Check Box 27' }, // Note space
      'his': { name: 'History ', box: 'Check Box 28' },
      'ins': { name: 'Insight', box: 'Check Box 29' },
      'itm': { name: 'Intimidation', box: 'Check Box 30' },
      'inv': { name: 'Investigation ', box: 'Check Box 31' },
      'med': { name: 'Medicine', box: 'Check Box 32' },
      'nat': { name: 'Nature', box: 'Check Box 33' },
      'prc': { name: 'Perception ', box: 'Check Box 34' },
      'prf': { name: 'Performance', box: 'Check Box 35' },
      'per': { name: 'Persuasion', box: 'Check Box 36' },
      'rel': { name: 'Religion', box: 'Check Box 37' },
      'slt': { name: 'SleightofHand', box: 'Check Box 38' },
      'ste': { name: 'Stealth ', box: 'Check Box 39' },
      'sur': { name: 'Survival', box: 'Check Box 40' }
    };

    for (const [key, conf] of Object.entries(skillsMap)) {
      const skill = data.skills[key];
      const mod = skill.total;
      setField(form, conf.name, (mod >= 0 ? "+" : "") + mod);
      if (skill.value >= 1) setCheckbox(form, conf.box, true);
    }

    // --- COMBAT ---
    setField(form, 'HPMax', data.attributes.hp.max.toString());
    setField(form, 'HPCurrent', data.attributes.hp.value.toString());
    
    // AC
    const ac = data.attributes.ac.value || 10;
    setField(form, 'AC', ac.toString());

    // Initiative
    const init = data.attributes.init.total;
    setField(form, 'Initiative', (init >= 0 ? "+" : "") + init);

    // Speed
    const speed = data.attributes.movement.walk || 30;
    setField(form, 'Speed', `${speed} ft.`);

    // Passive Perception
    setField(form, 'Passive', data.skills.prc.passive.toString());
    
    // Prof Bonus
    const prof = data.attributes.prof;
    setField(form, 'ProfBonus', `+${prof}`);

    // --- WEAPONS ---
    const weapons = items.filter(i => i.type === "weapon").slice(0, 3);
    weapons.forEach((w, i) => {
        const suffix = i === 0 ? "" : i === 1 ? " " : "  "; // Weird PDF naming: "Wpn Name", "Wpn Name 2", "Wpn Name 3"
        // Python map:
        // 0: "Wpn Name", "Wpn1 AtkBonus", "Wpn1 Damage"
        // 1: "Wpn Name 2", "Wpn2 AtkBonus ", "Wpn2 Damage "
        // 2: "Wpn Name 3", "Wpn3 AtkBonus  ", "Wpn3 Damage "
        
        let nameField = "Wpn Name";
        let atkField = "Wpn1 AtkBonus";
        let dmgField = "Wpn1 Damage";

        if (i === 1) { nameField = "Wpn Name 2"; atkField = "Wpn2 AtkBonus "; dmgField = "Wpn2 Damage "; }
        if (i === 2) { nameField = "Wpn Name 3"; atkField = "Wpn3 AtkBonus  "; dmgField = "Wpn3 Damage "; }

        setField(form, nameField, w.name);
        
        // Attack Bonus (Approximate from weapon data if not computed in item)
        // Foundry Items usually have 'labels' or derived data if on an actor
        const atkLabel = w.labels?.toHit || ""; 
        setField(form, atkField, atkLabel.replace('+', '+ ')); // format

        // Damage
        const dmgLabel = (w.labels?.damage || "") + " " + (w.labels?.damageTypes || "");
        setField(form, dmgField, dmgLabel);
    });

    // --- INVENTORY ---
    let inventoryText = "";
    
    // Currency
    const cur = data.currency;
    if (cur.cp) setField(form, 'CP', cur.cp.toString());
    if (cur.sp) setField(form, 'SP', cur.sp.toString());
    if (cur.ep) setField(form, 'EP', cur.ep.toString());
    if (cur.gp) setField(form, 'GP', cur.gp.toString());
    if (cur.pp) setField(form, 'PP', cur.pp.toString());

    // Items
    const gear = items.filter(i => ["equipment", "loot", "consumable", "backpack", "tool", "weapon"].includes(i.type));
    const invLines = gear.map(i => {
        const qty = i.system.quantity || 1;
        return qty > 1 ? `${qty}x ${i.name}` : i.name;
    });
    // Remove duplicates/join
    inventoryText = [...new Set(invLines)].join("\n");
    setField(form, 'Equipment', inventoryText);

    // --- SPELLS ---
    // Python Logic: Cantrips 1014-1022 (fields, order specific)
    // Levels 1-9: 1023...
    
    const spells = items.filter(i => i.type === "spell");
    const spellsByLevel = {};
    for (let l = 0; l <= 9; l++) spellsByLevel[l] = [];

    spells.forEach(s => {
        const lvl = s.system.level;
        if (spellsByLevel[lvl]) spellsByLevel[lvl].push(s);
    });

    // Sort alphabetically
    for (let l = 0; l <= 9; l++) {
        spellsByLevel[l].sort((a, b) => a.name.localeCompare(b.name));
    }

    // Fill Cantrips
    const cantripFields = [1014, 1016, 1017, 1018, 1019, 1020, 1021, 1022, 1015];
    spellsByLevel[0].slice(0, 9).forEach((s, i) => {
        setField(form, `Spells ${cantripFields[i]}`, s.name + (s.system.components?.ritual ? " (R)" : ""));
    });

    // Fill Levels 1-9
    const levelStartFields = {
        1: 1023, 2: 1032, 3: 1041, 4: 1050, 5: 1059, 
        6: 1068, 7: 1077, 8: 1086, 9: 1095
    };

    for (let lvl = 1; lvl <= 9; lvl++) {
        const start = levelStartFields[lvl];
        const lvlSpells = spellsByLevel[lvl].slice(0, 9); // Max 9 per level on this sheet
        
        lvlSpells.forEach((s, i) => {
            let name = s.name;
            if (s.system.preparation.prepared) name = "✓ " + name;
            if (s.system.components?.ritual) name += " (R)";
            setField(form, `Spells ${start + i}`, name);
        });
        
        // Slots
        const slots = data.spells[`spell${lvl}`];
        if (slots) {
             const pdfLvl = 18 + lvl; // 19-27
             setField(form, `SlotsTotal ${pdfLvl}`, (slots.max || 0).toString());
             setField(form, `SlotsRemaining ${pdfLvl}`, (slots.value || 0).toString());
        }
    }
    
    // Spellcasting Info
    if (classes.length > 0) {
         const spellcasterMap = {
             "wizard": "int", "artificer": "int",
             "bard": "cha", "sorcerer": "cha", "paladin": "cha", "warlock": "cha",
             "cleric": "wis", "druid": "wis", "ranger": "wis"
         };

         let detectedAbility = null;
         let detectedClass = null;

         for (const cls of classes) {
             const className = cls.name.toLowerCase();
             for (const [key, abil] of Object.entries(spellcasterMap)) {
                 if (className.includes(key)) {
                     detectedAbility = abil;
                     detectedClass = cls.name;
                     break;
                 }
             }
             if (detectedAbility) break;
         }

         const scAbility = detectedAbility || data.attributes.spellcasting || "int";
         const spellCasterClass = detectedClass || classes[0].name;

         console.log(`5e Companion Importer | Exporting PDF: Detected Spellcasting Ability: ${scAbility} from class ${spellCasterClass}`);
         
         if (scAbility) {
             const abilityName = abilities[scAbility]?.name || scAbility;
             setField(form, 'SpellcastingAbility 2', abilityName);
             setField(form, 'Spellcasting Class 2', spellCasterClass);

             // Recalculate DC/Atk if not in attributes (common for imports)
             let dc = data.attributes.spelldc;
             if (!dc || dc === 10) { // If default/missing, calc manually
                 const mod = data.abilities[scAbility]?.mod || 0;
                 const prof = data.attributes.prof || 2;
                 dc = 8 + mod + prof;
             }
             setField(form, 'SpellSaveDC  2', dc.toString());

             const atk = dc - 8;
             setField(form, 'SpellAtkBonus 2', `+${atk}`);
         }
    }

    // 3. Save and Download
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${actor.name}_sheet.pdf`;
    link.click();
    
    ui.notifications.info("PDF exported successfully!");

  } catch (e) {
    console.error(e);
    ui.notifications.error("Error generating PDF: " + e.message);
  }
}

// Helper to safely set fields if they exist
function setField(form, name, value) {
    try {
        const field = form.getTextField(name);
        if (field) {
            field.setText(value);
        } else {
             // Try searching by partial match or log it
             // console.warn(`Field ${name} not found.`);
        }
    } catch (e) {
        // console.error(`Error setting field ${name}:`, e);
    }
}

function setCheckbox(form, name, checked) {
    try {
        const field = form.getCheckBox(name);
        if (field && checked) field.check();
    } catch (e) {
        // console.warn(`Checkbox ${name} not found.`);
    }
}
