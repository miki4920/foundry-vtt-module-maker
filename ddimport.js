
Hooks.once('init', async function() {
  game.settings.register("foundry-vtt-module-maker", "author", {
    name: "Author",
    hint: "Set Author Name That Will Be Appended To Each Module",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });

  game.settings.register("foundry-vtt-module-maker", "pixelsPerGrid", {
    name: "Pixels Per Grid",
    hint: "Size of each grid square in pixels",
    scope: "world",
    config: true,
    type: Number,
    default: 140,
  });
});

Hooks.on("renderSceneDirectory", async (app, html) => {
  let footer = $("#scenes .directory-footer.action-buttons");
  if (footer.find("button:contains('Module Maker')").length === 0) {
    let sessionButton = $("<button class='import-dd'><i class='fas fa-file-import'></i>Module Maker</button>");
    footer.append(sessionButton);
    sessionButton.on("click", function() {
      new DDImporter().render(true);
    });
  }
});

export class DDImporter extends FormApplication {
  static get defaultOptions() {
    const options = super.defaultOptions;
    options.id = "module-maker";
    options.template = "modules/foundry-vtt-module-maker/importer.html"
    options.classes.push("module-maker");
    options.resizable = false;
    options.height = "auto";
    options.width = 400;
    options.minimizable = true;
    options.title = "Module Maker"
    return options;
  }

  getDirectoryName(name) {
    return decodeURI(name.split("/").at(-1))
  }

  async createModule(source, moduleName) {
    await FilePicker.createDirectory(source, "/modules/" + moduleName)
    await FilePicker.createDirectory(source, "/modules/" + moduleName + "/" + "maps")
    let response = await fetch("modules/foundry-vtt-module-maker/template.json")
    let moduleFile = await response.json()
    moduleFile.id = moduleName
    moduleFile.title = moduleName.split("-").map(word => {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(" ");
    moduleFile.description =  moduleFile.description + game.settings.get("foundry-vtt-module-maker", "author")
    moduleFile.compatibility.verified = game.version
    moduleFile.packs[0].label = moduleFile.title
    moduleFile.packs[0].name = moduleFile.id
    moduleFile.authors[0].name = game.settings.get("foundry-vtt-module-maker", "author").toLowerCase()
    moduleFile = JSON.stringify(moduleFile, null, 4)
    moduleFile = new Blob([moduleFile], {type : 'application/json'})
    moduleFile = new File([moduleFile], "module.json", {type: 'application/json'});
    await FilePicker.upload(source, "/modules/" + moduleName + "/", moduleFile)
  }

  async _updateObject(event, formData) {
    try {
      let directory = formData["directory"]
      let fidelity = parseInt(formData["fidelity"])
      let source = "data"
      let pixelsPerGrid = game.settings.get("foundry-vtt-module-maker", "pixelsPerGrid")
      let moduleName = game.settings.get("foundry-vtt-module-maker", "author").toLowerCase() + "-" + this.getDirectoryName(directory).split(" ").join("-").toLowerCase()
      await this.createModule(source, moduleName)
      moduleName = "/modules/" + moduleName + "/maps/"
      let directoryPicker = await FilePicker.browse(...new FilePicker()._inferSourceAndTarget(directory))
      await Folder.create({name: this.getDirectoryName(directory), type: "Scene"}).then(async parentFolder => {
        for (const dir of directoryPicker.dirs) {
          let directory = this.getDirectoryName(dir)
          await Folder.create({name: this.getDirectoryName(directory), type: "Scene", folder: parentFolder.id}).then(async sceneFolder => {
            let currentDirectory = await FilePicker.browse(...new FilePicker()._inferSourceAndTarget(dir))
            for (let path of currentDirectory.files) {
              const response = await fetch(path);
              const file = await response.json();
              let size = {}
              size.x = file.resolution.map_size.x
              size.y = file.resolution.map_size.y
              let grid_size = { 'x': size.x, 'y': size.y }
              size.x = size.x * pixelsPerGrid
              size.y = size.y * pixelsPerGrid

              let width, height

              file.pos_in_image = { "x": 0, "y": 0}
              file.pos_in_grid = { "x": 0, "y": 0}

              width = grid_size.x * pixelsPerGrid
              height = grid_size.y * pixelsPerGrid
              //placement math done.
              //Now use the image direct, in case of only one image and no conversion required
              let imageType = 'avif';
			  let fileName = this.getDirectoryName(path).split(".")[0];
			  let imageBytes = atob(file.image);
		      let imageArray = new Uint8Array(imageBytes.length);

			  for (let i = 0; i < imageBytes.length; i++) {
				imageArray[i] = imageBytes.charCodeAt(i);
			  }
			  let imageBlob = new Blob([imageArray], { type: "image/avif" });
			  let imageFile = new File([imageBlob], fileName + ".avif", { type: "image/avif" });
			  await FilePicker.upload(source, moduleName, imageFile);

              // aggregate the walls and place them right
              let aggregated = {
                "format": 0.2,
                "resolution": {
                  "map_origin": { "x": file.resolution.map_origin.x, "y": file.resolution.map_origin.y },
                  "map_size": { "x": grid_size.x, "y": grid_size.y },
                  "pixels_per_grid": pixelsPerGrid,
                },
                "line_of_sight": [],
                "portals": [],
                "environment": file["environment"],
                "lights": [],
              }

              let f = file;
              f.line_of_sight = f.line_of_sight.concat(f.objects_line_of_sight || [])
              f.line_of_sight.forEach(function (los) {
                los.forEach(function (z) {
                  z.x += f.pos_in_grid.x
                  z.y += f.pos_in_grid.y
                })
              })
              f.portals.forEach(function (port) {
                port.position.x += f.pos_in_grid.x
                port.position.y += f.pos_in_grid.y
                port.bounds.forEach(function (z) {
                  z.x += f.pos_in_grid.x
                  z.y += f.pos_in_grid.y
                })
              })
              f.lights.forEach(function (port) {
                port.position.x += f.pos_in_grid.x
                port.position.y += f.pos_in_grid.y
              })

              aggregated.line_of_sight = aggregated.line_of_sight.concat(f.line_of_sight)
              aggregated.lights = aggregated.lights.concat(f.lights)
              aggregated.portals = aggregated.portals.concat(f.portals)
              await this.DDImport(aggregated, fileName, moduleName, fidelity, imageType, source, pixelsPerGrid, sceneFolder, imageFile)
            }

          })
        }
      })
    }
    catch (e) {
      ui.notifications.error("Error Importing: " + e)
    }
  }

  async importModuleMaps(sceneFolder, folderPath) {
    try {
      let fidelity = 1;
      let source = "data"
      let pixelsPerGrid = 140;
      let currentDirectory = await FilePicker.browse(...new FilePicker()._inferSourceAndTarget(folderPath))
      for (let path of currentDirectory.files) {
        if (path.endsWith('dd2vtt')) {
          const response = await fetch(path);
          const file = await response.json();
          let size = {}
          size.x = file.resolution.map_size.x
          size.y = file.resolution.map_size.y
          let grid_size = { 'x': size.x, 'y': size.y }
          size.x = size.x * pixelsPerGrid
          size.y = size.y * pixelsPerGrid
          let width, height
          file.pos_in_image = { "x": 0, "y": 0}
          file.pos_in_grid = { "x": 0, "y": 0}
          width = grid_size.x * pixelsPerGrid
          height = grid_size.y * pixelsPerGrid
          let imageType = '?';
          imageType = DDImporter.getImageType(atob(file.image.substr(0, 8)));
          let fileName = this.getDirectoryName(path).split(".")[0]
          let imageBytes = atob(file.image)
          let imageArray = new Uint8Array(imageBytes.length);
          for (let i = 0; i < imageBytes.length; i++) {
            imageArray[i] = imageBytes.charCodeAt(i);
          }
          let imageBlob = new Blob([imageArray], { type: "image/"+imageType });
          let imageFile = new File([imageBlob], fileName + "." + imageType, { type: "image/"+imageType });
          await FilePicker.upload(source, folderPath, imageFile)
          let aggregated = {
            "format": 0.2,
            "resolution": {
              "map_origin": { "x": file.resolution.map_origin.x, "y": file.resolution.map_origin.y },
              "map_size": { "x": grid_size.x, "y": grid_size.y },
              "pixels_per_grid": pixelsPerGrid,
            },
            "line_of_sight": [],
            "portals": [],
            "environment": file["environment"],
            "lights": [],
          }
          let f = file;
          f.line_of_sight = f.line_of_sight.concat(f.objects_line_of_sight || [])
          f.line_of_sight.forEach(function (los) {
            los.forEach(function (z) {
              z.x += f.pos_in_grid.x
              z.y += f.pos_in_grid.y
            })
          })
          f.portals.forEach(function (port) {
            port.position.x += f.pos_in_grid.x
            port.position.y += f.pos_in_grid.y
            port.bounds.forEach(function (z) {
              z.x += f.pos_in_grid.x
              z.y += f.pos_in_grid.y
            })
          })
          f.lights.forEach(function (port) {
            port.position.x += f.pos_in_grid.x
            port.position.y += f.pos_in_grid.y
          })
          aggregated.line_of_sight = aggregated.line_of_sight.concat(f.line_of_sight)
          aggregated.lights = aggregated.lights.concat(f.lights)
          aggregated.portals = aggregated.portals.concat(f.portals)
          await this.DDImport(aggregated, fileName, folderPath, fidelity, imageType, source, pixelsPerGrid, sceneFolder, imageFile)
        }
      }
    }
    catch (e) {
      ui.notifications.error("Error Importing: " + e)
    }
  }

  activateListeners(html) {
    super.activateListeners(html)
    DDImporter.checkFidelity(html)
    html.find(".fidelity-input").change(ev => DDImporter.checkFidelity(html))
  }

  static checkFidelity(html) {
    let fidelityValue = $("[name='fidelity']")[0].value
    if (Number(fidelityValue) > 1) {
      html.find(".warning.fidelity")[0].style.display = ""
    }
    else
      html.find(".warning.fidelity")[0].style.display = "none"

  }

  static getImageType(bytes) {
    let magic = bytes.substr(0, 4);
    if (magic == "\u0089PNG") {
      return 'png'
    } 
	else if (magic == "\u00ff\u00d8\u00ff\u00e0") {
      return 'jpeg';
    }
    return 'png';
  }

  async createThumbnail(file, callback) {
      const reader = new FileReader();
      reader.onload = function(e) {
          const img = new Image();
          img.onload = function() {
              // Create a canvas to draw the thumbnail
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');
              const maxSize = 100; // Thumbnail dimension

              // Calculate the scaling factor
              const scaleFactor = Math.min(maxSize / img.width, maxSize / img.height);
              canvas.width = img.width * scaleFactor;
              canvas.height = img.height * scaleFactor;

              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

              const thumbnailDataUrl = canvas.toDataURL('image/webp');
              callback(thumbnailDataUrl);
          };

          img.onerror = function() {
              console.error("There was an error processing the file!");
          };

          img.src = e.target.result;
      };

      reader.onerror = function() {
          console.error("There was an error reading the file!");
      };
      reader.readAsDataURL(file);
  }

  async DDImport(file, fileName, path, fidelity, extension, source, pixelsPerGrid, parent, thumbnailFile) {
    let offset = 0
    let imagePath = path + fileName + "." + extension;
    let newScene = new Scene({
      name: fileName,
      grid: {size: pixelsPerGrid},
      background: {src: imagePath},
      width: pixelsPerGrid * file.resolution.map_size.x,
      height: pixelsPerGrid * file.resolution.map_size.y,
	  navigation: false,
      padding: 0,
      shiftX: 0,
      shiftY: 0,
      folder: parent.id
    })
    newScene.updateSource(
      {
        walls: DDImporter.GetWalls(file, newScene, 6 - fidelity, offset, pixelsPerGrid).concat(DDImporter.GetDoors(file, newScene, offset, pixelsPerGrid)).map(i => i.toObject()),
        lights: DDImporter.GetLights(file, newScene, pixelsPerGrid).map(i => i.toObject())
      })
    let scene = await Scene.create(newScene.toObject());
	await this.createThumbnail(thumbnailFile, (thumb) => {
      scene.update({"thumb": thumb});
    })
  }

  static GetWalls(file, scene, skipNum, offset, pixelsPerGrid) {
    let walls = [];
    let ddWalls = file.line_of_sight

    for (let wsIndex = 0; wsIndex < ddWalls.length; wsIndex++) {
      let wallSet = ddWalls[wsIndex]
      // Find walls that directly end on this walls endpoints. So we can close walls, after applying offets
      let connectTo = []
      let connectedTo = []
      for (let i = 0; i < ddWalls.length; i++) {

        if (i == wsIndex) continue
        if (wallSet[wallSet.length - 1].x == ddWalls[i][0].x && wallSet[wallSet.length - 1].y == ddWalls[i][0].y) {
          connectTo.push(ddWalls[i][0])
        }
        if (wallSet[0].x == ddWalls[i][ddWalls[i].length - 1].x && wallSet[0].y == ddWalls[i][ddWalls[i].length - 1].y) {
          connectedTo.push(wallSet[0])
        }
      }

      wallSet = this.preprocessWalls(wallSet, skipNum)
      // Connect to walls that end *before* the current wall
      for (let i = 0; i < connectedTo.length; i++) {
        if (DDImporter.isWithinMap(file, connectedTo[i]) || DDImporter.isWithinMap(file, wallSet[0]))
          walls.push(this.makeWall(file, scene, connectedTo[i], wallSet[0], pixelsPerGrid))
      }
      for (let i = 0; i < wallSet.length - 1; i++) {
        if (DDImporter.isWithinMap(file, wallSet[i]) || DDImporter.isWithinMap(file, wallSet[i + 1]))
          walls.push(this.makeWall(file, scene, wallSet[i], wallSet[i + 1], pixelsPerGrid))
      }
      // Connect to walls that end *after* the current wall
      for (let i = 0; i < connectTo.length; i++) {
        if (DDImporter.isWithinMap(file, wallSet[wallSet.length - 1]) || DDImporter.isWithinMap(file, connectTo[i]))
          walls.push(this.makeWall(file, scene, wallSet[wallSet.length - 1], connectTo[i], pixelsPerGrid))
      }
    }

    return walls.filter(w => w)
  }

  static makeWall(file, scene, pointA, pointB, pixelsPerGrid) {
    let sceneDimensions = scene.getDimensions()
    let offsetX = sceneDimensions.sceneX
    let offsetY = sceneDimensions.sceneY
    let originX = file.resolution.map_origin.x
    let originY = file.resolution.map_origin.y

    try {
      return new WallDocument({
        c: [
          ((pointA.x - originX) * pixelsPerGrid) + offsetX,
          ((pointA.y - originY) * pixelsPerGrid) + offsetY,
          ((pointB.x - originX) * pixelsPerGrid) + offsetX,
          ((pointB.y - originY) * pixelsPerGrid) + offsetY
        ]
      })
    }
    catch (e) {
      console.error("Could not create Wall Document: " + e)
    }
  }

  static preprocessWalls(wallSet, numToSkip) {
    let toRemove = [];
    let skipCounter = 0;
    for (let i = 0; i < wallSet.length - 2; i++) {
      if (i != 0 && i != wallSet.length - 2 && this.distance(wallSet[i], wallSet[i + 1]) < 0.3) {
        if (skipCounter == numToSkip) {
          skipCounter = 0;
        }
        else {
          skipCounter++;
          toRemove.push(i);
        }
      }
      else
        skipCounter = 0;
    }
    if (toRemove.length) {
      for (let i = toRemove.length - 1; i > 0; i--) {
        wallSet.splice(toRemove[i], 1)
      }
    }
    return wallSet
  }

  static distance(p1, p2) {
    return Math.sqrt(Math.pow((p1.x - p2.x), 2) + Math.pow((p1.y - p2.y), 2))
  }

  static GetDoors(file, scene, offset, pixelsPerGrid) {
    let doors = [];
    let ddDoors = file.portals;
    let sceneDimensions = scene.getDimensions()
    let offsetX = sceneDimensions.sceneX
    let offsetY = sceneDimensions.sceneY
	
	let originX = file.resolution.map_origin.x
    let originY = file.resolution.map_origin.y

    for (let door of ddDoors) {
      try {

        doors.push(new WallDocument({
          c: [
            ((door.bounds[0].x - originX) * pixelsPerGrid) + offsetX,
            ((door.bounds[0].y - originY) * pixelsPerGrid) + offsetY,
            ((door.bounds[1].x - originX) * pixelsPerGrid) + offsetX,
            ((door.bounds[1].y - originY) * pixelsPerGrid) + offsetY
          ],
          door: door.closed ? 1 : 0, // If openable windows - all portals should be doors, otherwise, only portals that "block light" should be openable (doors)
          sense: (door.closed) ? CONST.WALL_SENSE_TYPES.NORMAL : CONST.WALL_SENSE_TYPES.NONE
        }))
      }
      catch(e)
      {
        console.error("Could not create Wall Document (door): " + e)
      }
    }

    return doors.filter(d => d)
  }

  static GetLights(file, scene, pixelsPerGrid) {
    let lights = [];
    let sceneDimensions = scene.getDimensions()
    let offsetX = sceneDimensions.sceneX
    let offsetY = sceneDimensions.sceneY
    for (let light of file.lights) {
      if (DDImporter.isWithinMap(file, light.position)) {
        try {
          let newLight = new AmbientLightDocument({
            x: ((light.position.x - file.resolution.map_origin.x) * pixelsPerGrid) + offsetX,
            y: ((light.position.y - file.resolution.map_origin.y) * pixelsPerGrid) + offsetY,
            rotation: 0,
            config: {
              angle: 360,
              color: "#" + light.color.substring(2),
              dim: light.range * (game.system.grid.distance || 1) * 2,
              bright: (light.range * (game.system.grid.distance || 1)) / 2,
              alpha: (0.05 * light.intensity)
            }
          })
          lights.push(newLight);
        }
        catch (e)
        {
          console.error("Could not create AmbientLight Document: " + e)
        }
      }
    }
    return lights.filter(l => l);
  }

  /**
   * Checks if point is within map crop
   * 
   * @param {Object} file uvtt file
   * @param {Object} position {x, y}
   * @returns 
   */
  static isWithinMap(file, position) {

    let map_originX = file.resolution.map_origin.x
    let map_originY = file.resolution.map_origin.y

    let map_sizeX = file.resolution.map_size.x
    let map_sizeY = file.resolution.map_size.y


    let within;

    if (
      position.x >= map_originX &&
      position.x <= map_originX + map_sizeX &&
      position.y >= map_originY &&
      position.y <= map_originY + map_sizeY)
      within = true
    else within = false

    return within

  }
}