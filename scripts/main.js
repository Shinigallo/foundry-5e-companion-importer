
console.log("5e Companion Importer | Initializing");

Hooks.on("renderActorDirectory", (app, html, data) => {
  const button = $(
    `<button class="import-companion"><i class="fas fa-file-import"></i> Import 5e Companion</button>`
  );
  
  button.on("click", () => {
    new CompanionImportDialog().render(true);
  });

  html.find(".directory-footer").append(button);
});

class CompanionImportDialog extends Application {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      id: "companion-import-dialog",
      title: "Import 5e Companion Character",
      template: "modules/foundry-5e-companion-importer/templates/import-dialog.html",
      width: 400,
      height: "auto",
      classes: ["companion-importer"],
    });
  }

  // We don't really need a template file if we override render, 
  // but for standard practice let's just generate the HTML content here directly 
  // to avoid creating another file for now (MVP).
  render(force, options) {
    const content = `
      <div style="padding: 10px;">
        <p>Select a .cah file exported from the 5e Companion App.</p>
        <div class="form-group">
          <label>File:</label>
          <input type="file" id="cah-upload" accept=".cah,.json" style="width: 100%;">
        </div>
        <hr>
        <div style="display: flex; justify-content: flex-end;">
          <button id="do-import">Import</button>
        </div>
      </div>
    `;
    
    // Create a temporary dialog instead of a full Application if we want simpler logic, 
    // but sticking to Application pattern is fine.
    // However, since we didn't create the template file, we'll manually inject HTML.
    
    const d = new Dialog({
      title: "Import 5e Companion",
      content: content,
      buttons: {
        import: {
          icon: '<i class="fas fa-check"></i>',
          label: "Import",
          callback: async (html) => {
            const fileInput = html.find("#cah-upload")[0];
            if (!fileInput.files.length) return ui.notifications.error("No file selected.");
            const file = fileInput.files[0];
            await this.processFile(file);
          }
        }
      },
      default: "import"
    });
    d.render(true);
  }

  async processFile(file) {
    const text = await file.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return ui.notifications.error("Invalid JSON format.");
    }

    try {
      await importCharacter(json);
      ui.notifications.info(`Character "${json.name}" imported successfully!`);
    } catch (e) {
      console.error(e);
      ui.notifications.error(`Error importing character: ${e.message}`);
    }
  }
}

// --- MAPPING LOGIC ---

async function importCharacter(data) {
  console.log("Importing Data:", data);

  // 1. Basic Details
  const actorData = {
    name: data.name || "New Character",
    type: "character",
    img: "icons/svg/mystery-man.svg", // Default
    system: {
      abilities: {},
      attributes: {},
      details: {},
      skills: {},
      traits: {
        size: "med", // Default, could infer from race
        languages: { value: [] }
      }
    }
  };

  // 2. Abilities
  const abilities = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
  const abilityKeys = {
    'strength': 'str', 'dexterity': 'dex', 'constitution': 'con', 
    'intelligence': 'int', 'wisdom': 'wis', 'charisma': 'cha'
  };

  for (const ab of abilities) {
    const key = abilityKeys[ab];
    const score = data[ab]?.score || 10;
    const save = data[ab]?.save || false;
    
    actorData.system.abilities[key] = {
      value: score,
      proficient: save ? 1 : 0
    };
  }

  // 3. HP & AC
  actorData.system.attributes.hp = {
    value: data.hp || 10,
    max: data.hp || 10
  };
  
  // AC is tricky. Foundry calc is auto by default.
  // If we want to force it:
  const baseAc = data.baseAc || 10;
  const extraAc = data.extraAC || 0;
  actorData.system.attributes.ac = {
    flat: baseAc + extraAc,
    calc: "flat" 
  };

  // 4. Details
  actorData.system.details.xp = { value: data.xp || 0 };
  actorData.system.details.alignment = (data.alignmentName || "").replace(/_/g, " ").titleCase();
  actorData.system.details.background = (data.background?.backgroundId || "").replace(/_/g, " ").titleCase();
  
  // Currency (Gold)
  if (data.background?.goldPieces) {
    actorData.system.currency = { gp: data.background.goldPieces };
  }

  // Speed
  if (data.race?.speed?.normal) {
    actorData.system.attributes.movement = { walk: data.race.speed.normal };
  }

  // 5. Skills
  const skillMap = {
    'ACROBATICS': 'acr', 'ANIMAL_HANDLING': 'ani', 'ARCANA': 'arc', 'ATHLETICS': 'ath',
    'DECEPTION': 'dec', 'HISTORY': 'his', 'INSIGHT': 'ins', 'INTIMIDATION': 'itm',
    'INVESTIGATION': 'inv', 'MEDICINE': 'med', 'NATURE': 'nat', 'PERCEPTION': 'prc',
    'PERFORMANCE': 'prf', 'PERSUASION': 'per', 'RELIGION': 'rel', 'SLEIGHT_OF_HAND': 'slt',
    'STEALTH': 'ste', 'SURVIVAL': 'sur'
  };

  if (data.skills) {
    for (const skill of data.skills) {
      const key = skillMap[skill.typeName];
      if (key) {
        let prof = 0;
        if (skill.proficiencyName === 'FULL') prof = 1;
        if (skill.proficiencyName === 'EXPERT') prof = 2; // Expertise
        
        actorData.system.skills[key] = { value: prof };
      }
    }
  }

  // CREATE ACTOR
  const actor = await Actor.create(actorData);

  // --- ITEMS & SPELLS ---
  const itemsToCreate = [];

  // Helper to add items from CAH equipment lists
  const addEquipmentItems = async (equipList) => {
    if (!equipList || !Array.isArray(equipList)) return;
    for (const entry of equipList) {
        if (!entry.equipmentsModels) continue;
        for (const model of entry.equipmentsModels) {
            const name = model.name;
            if (!name) continue;
            
            let invItem = await findItemInCompendium(name);
            if (!invItem) {
                invItem = { 
                    name: name, 
                    type: "loot",
                    system: { description: { value: model.description || "" } }
                };
            }
            
            // Quantity
            const qty = model.number || 1;
            foundry.utils.mergeObject(invItem, {
                system: { quantity: qty }
            });
            
            itemsToCreate.push(invItem);
        }
    }
  };

  // 1. Items from Background
  if (data.background?.equipment) {
      await addEquipmentItems(data.background.equipment);
  }

  // 2. Items from Classes (Jobs)
  if (data.jobs) {
      for (const job of data.jobs) {
          if (job.equipment) await addEquipmentItems(job.equipment);
      }
  }

  // 3. General Inventory (if any)
  if (data.inventory) await addEquipmentItems(data.inventory);
  if (data.items) await addEquipmentItems(data.items);


  // Race
  if (data.race?.raceId) {
    const raceName = data.race.raceId.replace(/_/g, " ").titleCase();
    const subRace = data.race.subraceId ? data.race.subraceId.replace(/_/g, " ").titleCase() : "";
    const fullName = subRace ? `${raceName} (${subRace})` : raceName;
    
    // Try to fetch from compendium or create placeholder
    const itemData = await findItemInCompendium(raceName, "race") || {
        name: fullName,
        type: "race"
    };
    if(itemData.name !== fullName) itemData.name = fullName; // Update name to include subrace if generic found
    itemsToCreate.push(itemData);
  }

  // Classes
  if (data.jobs) {
    for (const job of data.jobs) {
        const className = job.jobId.replace(/_/g, " ").titleCase();
        const level = job.level || 1;
        
        // Find class
        let classItem = await findItemInCompendium(className, "class");
        if (!classItem) {
            classItem = { name: className, type: "class" };
        }
        
        // Set level
        if (!classItem.system) classItem.system = {};
        classItem.system.levels = level;
        
        itemsToCreate.push(classItem);
    }
  }

  // Spells
  if (data.spells) {
    for (const spell of data.spells) {
        const spellName = spell.name; // Usually clean in CAH
        let spellItem = await findItemInCompendium(spellName, "spell");
        
        if (!spellItem) {
            spellItem = {
                name: spellName,
                type: "spell",
                system: {
                    level: spell.level || 0,
                    preparation: {
                        mode: "prepared",
                        prepared: spell.prepared || false
                    }
                }
            };
        } else {
            // Update preparation status
             foundry.utils.mergeObject(spellItem, {
                system: {
                    preparation: {
                        prepared: spell.prepared || false
                    }
                }
             });
        }
        itemsToCreate.push(spellItem);
    }
  }
  
  // Inventory / Equipment (Try to find generic fields if they exist)
  const inventory = data.inventory || data.items || [];
  if (inventory.length > 0) {
      for (const item of inventory) {
          // Assuming item structure has 'name' and maybe 'count'/'quantity'
          const name = item.name || item.itemName;
          if (!name) continue;
          
          let invItem = await findItemInCompendium(name); // Search anywhere
          if (!invItem) {
              invItem = { name: name, type: "loot" };
          }
          
          // Quantity
          const qty = item.count || item.quantity || 1;
           foundry.utils.mergeObject(invItem, {
                system: { quantity: qty }
           });
           
          itemsToCreate.push(invItem);
      }
  }

  await actor.createEmbeddedDocuments("Item", itemsToCreate);
}

// --- HELPERS ---

async function findItemInCompendium(name, type=null) {
  // Search in standard dnd5e compendiums
  const packs = [
    "dnd5e.spells",
    "dnd5e.items",
    "dnd5e.classfeatures",
    "dnd5e.classes",
    "dnd5e.races",
    "dnd5e.heroes" // backgrounds usually
  ];

  for (const packId of packs) {
    const pack = game.packs.get(packId);
    if (!pack) continue;
    
    // Optimization: we could use index, but exact match search is safer
    // We get the index with fields needed to match
    const index = await pack.getIndex({fields: ["name", "type"]});
    const entry = index.find(i => i.name.toLowerCase() === name.toLowerCase() && (!type || i.type === type));
    
    if (entry) {
        return (await pack.getDocument(entry._id)).toObject();
    }
  }
  return null;
}

// String helper
String.prototype.titleCase = function() {
    return this.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};
