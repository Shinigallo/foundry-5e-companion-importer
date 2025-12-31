
import { exportToPdf } from "./pdf-export.js";

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

Hooks.on('getActorSheetHeaderButtons', (sheet, buttons) => {
  if (sheet.actor.type !== 'character') return;

  buttons.unshift({
    label: "Export to CAH",
    class: "export-cah",
    icon: "fas fa-file-export",
    onclick: () => exportToCah(sheet.actor)
  });
  
  buttons.unshift({
    label: "Export to PDF",
    class: "export-pdf",
    icon: "fas fa-file-pdf",
    onclick: () => exportToPdf(sheet.actor)
  });
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
  // Check for image data (often Base64 in .cah exports)
  // const imgData = data.image || data.imageUrl || "icons/svg/mystery-man.svg";
  
  const actorData = {
    name: data.name || "New Character",
    type: "character",
    img: "icons/svg/mystery-man.svg", // imgData, 
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
  
  // Currency (Root Level)
  actorData.system.currency = {
    cp: data.copper || 0,
    sp: data.silver || 0,
    ep: data.electrum || 0,
    gp: data.gold || 0,
    pp: data.platinum || 0
  };

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
  const addEquipmentItems = async (equipList, typeHint = null) => {
    if (!equipList || !Array.isArray(equipList)) return;
    for (const entry of equipList) {
        let itemsToProcess = [];
        if (entry.equipmentsModels) {
            itemsToProcess = entry.equipmentsModels.map(m => ({ name: m.name, qty: m.number || 1, desc: m.description }));
        } else if (entry.name) {
            itemsToProcess = [{ name: entry.name, qty: entry.count || 1, desc: "" }];
        }

        for (const item of itemsToProcess) {
            if (!item.name) continue;
            
            let invItem = await findItemInCompendium(item.name, typeHint);
            if (!invItem) {
                invItem = { 
                    name: item.name, 
                    type: typeHint || "loot",
                    system: { 
                        description: { value: item.desc || "" },
                        quantity: item.qty
                    }
                };
            } else {
                foundry.utils.mergeObject(invItem, {
                    system: { quantity: item.qty }
                });
            }
            itemsToCreate.push(invItem);
        }
    }
  };

  // 1. Root Level Equipment
  await addEquipmentItems(data.equipment);
  await addEquipmentItems(data.weapons, "weapon");
  await addEquipmentItems(data.armors, "equipment");

  // 2. Fallback from Classes (Jobs)
  if (data.jobs) {
      for (const job of data.jobs) {
          if (job.equipment) await addEquipmentItems(job.equipment);
      }
  }

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
            const icon = guessIcon(spellName);
            const searchUrl = `https://www.google.com/search?q=site:5e.tools+"${encodeURIComponent(spellName)}"`;
            
            spellItem = {
                name: spellName,
                type: "spell",
                img: icon,
                system: {
                    description: { 
                        value: `<p>Imported from 5e Companion App. Details not found in compendiums.</p>
                                <p><b><a href="${searchUrl}" target="_blank"><i class="fas fa-search"></i> Search on 5e.tools</a></b></p>` 
                    },
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

// --- EXPORT LOGIC ---

async function exportToCah(actor) {
  const data = actor.system;
  const items = actor.items;

  const cahData = {
    version: 1, // Basic versioning
    name: actor.name,
    image: "", // Skipping image export to keep file size small/simple
    hp: data.attributes.hp.value,
    baseAc: data.attributes.ac.flat || 10,
    totalAc: data.attributes.ac.value || 10,
    xp: data.details.xp.value,
    alignmentName: data.details.alignment ? data.details.alignment.toUpperCase().replace(/ /g, "_") : "",
    background: { backgroundId: data.details.background ? data.details.background.toUpperCase().replace(/ /g, "_") : "" },
    race: { raceId: actor.items.find(i => i.type === "race")?.name.toUpperCase().replace(/ /g, "_") || "" },
    
    // Currency
    copper: data.currency.cp,
    silver: data.currency.sp,
    electrum: data.currency.ep,
    gold: data.currency.gp,
    platinum: data.currency.pp,

    // Abilities
    strength: { score: data.abilities.str.value, save: data.abilities.str.proficient > 0 },
    dexterity: { score: data.abilities.dex.value, save: data.abilities.dex.proficient > 0 },
    constitution: { score: data.abilities.con.value, save: data.abilities.con.proficient > 0 },
    intelligence: { score: data.abilities.int.value, save: data.abilities.int.proficient > 0 },
    wisdom: { score: data.abilities.wis.value, save: data.abilities.wis.proficient > 0 },
    charisma: { score: data.abilities.cha.value, save: data.abilities.cha.proficient > 0 },
  };

  // Skills
  const skillMapRev = {
    'acr': 'ACROBATICS', 'ani': 'ANIMAL_HANDLING', 'arc': 'ARCANA', 'ath': 'ATHLETICS',
    'dec': 'DECEPTION', 'his': 'HISTORY', 'ins': 'INSIGHT', 'itm': 'INTIMIDATION',
    'inv': 'INVESTIGATION', 'med': 'MEDICINE', 'nat': 'NATURE', 'prc': 'PERCEPTION',
    'prf': 'PERFORMANCE', 'per': 'PERSUASION', 'rel': 'RELIGION', 'slt': 'SLEIGHT_OF_HAND',
    'ste': 'STEALTH', 'sur': 'SURVIVAL'
  };

  cahData.skills = [];
  for (const [key, skill] of Object.entries(data.skills)) {
    if (skill.value > 0) { // If proficient or expert
      cahData.skills.push({
        typeName: skillMapRev[key],
        proficiencyName: skill.value >= 2 ? 'EXPERT' : 'FULL'
      });
    }
  }

  // Classes (Jobs)
  cahData.jobs = items.filter(i => i.type === "class").map(c => ({
    jobId: c.name.toUpperCase().replace(/ /g, "_"),
    level: c.system.levels
  }));

  // Spells
  cahData.spells = items.filter(i => i.type === "spell").map(s => ({
    name: s.name,
    level: s.system.level,
    prepared: s.system.preparation.mode === "prepared" && s.system.preparation.prepared
  }));

  // Inventory Separation
  cahData.inventory = [];
  cahData.weapons = [];
  cahData.armors = [];

  for (const item of items) {
    const i = {
      name: item.name,
      count: item.system.quantity || 1,
      description: item.system.description.value || ""
    };

    if (item.type === "weapon") {
      cahData.weapons.push(i);
    } else if (item.type === "equipment" && item.system.armor) {
      cahData.armors.push(i);
    } else if (["loot", "consumable", "backpack", "tool"].includes(item.type)) {
      cahData.inventory.push(i);
    }
  }

  // Export
  const filename = `${actor.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.cah`;
  saveDataToFile(JSON.stringify(cahData, null, 2), "application/json", filename);
  ui.notifications.info("Character exported successfully!");
}

function saveDataToFile(content, contentType, fileName) {
  const a = document.createElement("a");
  const file = new Blob([content], { type: contentType });
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

// --- HELPERS ---

async function findItemInCompendium(name, type=null) {
  // 1. Search in local compendiums first
  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;

    const index = await pack.getIndex({fields: ["name", "type"]});
    const entry = index.find(i => i.name.toLowerCase() === name.toLowerCase() && (!type || i.type === type));
    
    if (entry) {
        return (await pack.getDocument(entry._id)).toObject();
    }
  }

  // 2. Fallback: Check Plutonium / 5e.tools if active
  // This logic attempts to use Plutonium's internal data loader if available.
  // Note: This relies on Plutonium exposing 'Vetools' or 'DataUtil' globally which is common in its API.
  if (game.modules.get("plutonium")?.active && type === "spell") {
    try {
        // Try to access Plutonium's loaded content or indices. 
        // This is a "best guess" integration as Plutonium's API is complex.
        // We look for the Vetools global object or similar.
        
        // Strategy: We can't easily trigger a full import, but we can try to guess metadata
        // or check if the user has cached data.
        
        // Simulating a successful hit if we were to have access:
        // Ideally we would do: const spell = await Vetools.pGetSpell(name);
        
        // Since we can't guarantee the API surface, we will leave a hook here.
        // If the user *has* the spell in a "World" item (imported via Plutonium), 
        // it would have been caught by the "game.packs" loop IF it was in a compendium.
        // If it's just in the "Items" directory, we should check there too!
        
        const worldItem = game.items.find(i => i.name.toLowerCase() === name.toLowerCase() && i.type === type);
        if (worldItem) return worldItem.toObject();

    } catch (e) {
        console.warn("Plutonium/5e.tools check failed:", e);
    }
  }

  return null;
}

// String helper
String.prototype.titleCase = function() {
    return this.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

function guessIcon(name) {
    const n = name.toLowerCase();
    if (n.includes("fire") || n.includes("flame") || n.includes("burn") || n.includes("heat")) return "icons/magic/fire/beam-jet-stream-embers.webp";
    if (n.includes("ice") || n.includes("frost") || n.includes("cold") || n.includes("freeze")) return "icons/magic/water/projectile-ice-shard.webp";
    if (n.includes("light") || n.includes("sun") || n.includes("day") || n.includes("beam")) return "icons/magic/light/beam-rays-yellow-orange.webp";
    if (n.includes("dark") || n.includes("shadow") || n.includes("night") || n.includes("necro")) return "icons/magic/unholy/projectile-bolts-salvo-purple.webp";
    if (n.includes("heal") || n.includes("cure") || n.includes("life") || n.includes("restore")) return "icons/magic/life/heart-cross-strong-green.webp";
    if (n.includes("protect") || n.includes("shield") || n.includes("armor") || n.includes("guard")) return "icons/magic/defensive/shield-barrier-blue.webp";
    if (n.includes("mind") || n.includes("thought") || n.includes("psychic") || n.includes("brain")) return "icons/magic/control/energy-stream-purple.webp";
    if (n.includes("thunder") || n.includes("lightning") || n.includes("storm") || n.includes("shock")) return "icons/magic/lightning/bolt-strike-blue.webp";
    if (n.includes("acid") || n.includes("poison") || n.includes("toxic") || n.includes("venom")) return "icons/magic/acid/splash-blob-purple.webp";
    if (n.includes("fly") || n.includes("wind") || n.includes("air") || n.includes("feather")) return "icons/magic/air/wind-stream-white.webp";
    
    return "icons/magic/symbols/question-stone-yellow.webp";
}
