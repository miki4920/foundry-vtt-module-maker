Hooks.on("renderSidebarTab", async (app, html) => {
  if (app instanceof SceneDirectory) {
    let button = $("<button class='import-dd'><i class='fas fa-file-import'></i> Module Maker</button>")

    button.click(function () {
      new DDImporter().render(true);
    });

    html.find(".directory-footer").append(button);
  }
})

Hooks.on("init", () => {
  game.settings.register("dd-import", "importSettings", {
    name: "Dungeondraft Default Path",
    scope: "world",
    config: false,
    default: {
      path: "worlds/" + game.world.id,
      fidelity: 3,
      wallsAroundFiles: true,
      useCustomPixelsPerGrid: false,
      defaultCustomPixelsPerGrid: 100,
    }
  })
})




class DDImporter extends FormApplication {


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

  async getData() {
    let data = await super.getData();
    let settings = game.settings.get("dd-import", "importSettings")
    data.path = settings.path || "";
    data.wallsAroundFiles = settings.wallsAroundFiles;
    data.useCustomPixelsPerGrid = settings.useCustomPixelsPerGrid;
    data.defaultCustomPixelsPerGrid = settings.defaultCustomPixelsPerGrid || 100;
    return data
  }

  getDirectoryName(name) {
    return decodeURI(name.split("/").at(-1))
  }

  async _updateObject(event, formData) {
    try {
      let directory = formData["directory"]
      let fidelity = parseInt(formData["fidelity"])
      let source = "data"
      let objectWalls = formData["object-walls"]
      let pixelsPerGrid = formData["customGridPPI"] * 1
      let directoryPicker = await FilePicker.browse(...new FilePicker()._inferCurrentDirectory(directory))
      await Folder.create({name: this.getDirectoryName(directory), type: "Scene"}).then(async parentFolder => {
        for (const dir of directoryPicker.dirs) {
          let directory = this.getDirectoryName(dir)
          await Folder.create({name: this.getDirectoryName(directory), type: "Scene", parent: parentFolder.id}).then(async sceneFolder => {
            let currentDirectory = await FilePicker.browse(...new FilePicker()._inferCurrentDirectory(dir))
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
              var image_type = '?'

              // This code works for both single files and multiple files and supports resizing during scene generation
              // Use a canvas to place the image in case we need to convert something
              let thecanvas = document.createElement('canvas');
              thecanvas.width = width;
              thecanvas.height = height;
              let mycanvas = thecanvas.getContext("2d");
              image_type = DDImporter.getImageType(atob(file.image.substr(0, 8)));
              let fileName = this.getDirectoryName(path).split(".")[0]
              await DDImporter.image2Canvas(mycanvas, file, image_type, size.x, size.y)

              var p = new Promise(function (resolve) {
                thecanvas.toBlob(function (blob) {
                  blob.arrayBuffer().then(bfr => {
                    DDImporter.uploadFile(bfr, fileName, dir, source, image_type)
                        .then(function () {
                          resolve()
                        })
                  });
                }, "image/" + image_type)
              })



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
              if (objectWalls)
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
              await p
              DDImporter.DDImport(aggregated, fileName, path, fidelity, image_type, source, pixelsPerGrid, sceneFolder)

              game.settings.set("dd-import", "importSettings", {
                source: source,
                path: path,
                fidelity: fidelity,
              });


            }

          })
        }
      })


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

  static DecodeImage(file) {
    var byteString = atob(file.image);
    var ab = new ArrayBuffer(byteString.length);
    var ia = new Uint8Array(ab);

    for (var i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return ab;
  }

  static Uint8ToBase64(u8Arr) {
    var CHUNK_SIZE = 0x8000;
    var index = 0;
    var length = u8Arr.length;
    var result = '';
    var slice;
    // we need to do slices for large amount of data
    while (index < length) {
      slice = u8Arr.subarray(index, Math.min(index + CHUNK_SIZE, length));
      result += String.fromCharCode.apply(null, slice);
      index += CHUNK_SIZE;
    }
    return btoa(result);
  }

  
  static Uint8ToBlob(u8Arr, type) {
    return new Blob([u8Arr], {type : "image/" + type});
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

  static image2Canvas(canvas, file, extension, imageWidth, imageHeight) {
    return new Promise(function (resolve) {
      var image = new Image();
      image.decoding = 'sync';
      image.addEventListener('load', function () {
        image.decode().then(() => {
          canvas.drawImage(image, file.pos_in_image.x, file.pos_in_image.y, imageWidth, imageHeight);
          resolve()
        }).catch(e => {
          console.log("decode failed because of DOMException, lets try directly");
          console.log(e);
          canvas.drawImage(image, file.pos_in_image.x, file.pos_in_image.y, imageWidth, imageHeight);
          resolve()
        });
      });
      image.src = URL.createObjectURL(DDImporter.Uint8ToBlob(DDImporter.DecodeImage(file), extension))
    });
  }

  static async uploadFile(file, name, path, source, extension) {
    let uploadFile = new File([file], name + "." + extension, { type: 'image/' + extension });
    await FilePicker.upload(source, decodeURI(path) + "/", uploadFile)
  }

  static async DDImport(file, fileName, path, fidelity, extension, source, pixelsPerGrid, parent) {
    let offset = 0
    path = path.split("/")
    path.pop()
    path = path.join("/") + "/"
    let imagePath = path + fileName + "." + extension;
    let newScene = new Scene({
      name: fileName,
      grid: pixelsPerGrid,
      img: imagePath,
      width: pixelsPerGrid * file.resolution.map_size.x,
      height: pixelsPerGrid * file.resolution.map_size.y,
      padding: 0,
      shiftX: 0,
      shiftY: 0,
      folder: parent.id
    })
    newScene.updateSource(
      {
        walls: this.GetWalls(file, newScene, 6 - fidelity, offset, pixelsPerGrid).concat(this.GetDoors(file, newScene, offset, pixelsPerGrid)).map(i => i.toObject()),
        lights: this.GetLights(file, newScene, pixelsPerGrid).map(i => i.toObject())
      })
    let scene = await Scene.create(newScene.toObject());
    scene.createThumbnail().then(thumb => {
      scene.update({ "thumb": thumb.thumb });
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

  static GetShortWallCount(wallSet, shortWallThreshold) {
    let shortCount = 0;
    for (let i = 0; i < wallSet.length - 1; i++) {
      if (this.distance(wallSet[i], wallSet[i + 1]) < shortWallThreshold) {
        shortCount++;
      }
    }
    return shortCount
  }

  static interception(wallinfo1, wallinfo2) {
    /*
     * x = (m2-m1)/(k1-k2)
     * y = k1*x + m1
     */
    if (wallinfo1.slope == undefined && wallinfo2.slope == undefined) {
      return { x: wallinfo1.x, y: (wallinfo1.y + wallinfo2.y) / 2 }
    }
    else if (wallinfo1.slope == undefined) {
      let m2 = wallinfo2.y - wallinfo2.slope * wallinfo2.x
      return { x: wallinfo1.x, y: wallinfo2.slope * wallinfo1.x + m2 }
    }
    else if (wallinfo2.slope == undefined) {
      let m1 = wallinfo1.y - wallinfo1.slope * wallinfo1.x
      return { x: wallinfo2.x, y: wallinfo1.slope * wallinfo2.x + m1 }
    }
    /* special case if we skipped a short wall, which leads to two parallel walls,
     * or we have a straight wall with multiple points. */
    else if (wallinfo1.slope == wallinfo2.slope) {
      if (wallinfo1.slope == 0) {
        return { x: wallinfo1.x + (wallinfo2.x - wallinfo1.x) / 2, y: wallinfo1.y }
      } else {
        return { x: wallinfo1.x, y: wallinfo1.y + (wallinfo2.y - wallinfo1.y) / 2 }
      }

    }
    let m1 = wallinfo1.y - wallinfo1.slope * wallinfo1.x
    let m2 = wallinfo2.y - wallinfo2.slope * wallinfo2.x
    let x = (m2 - m1) / (wallinfo1.slope - wallinfo2.slope)
    return { x: x, y: wallinfo1.slope * x + m1 }
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

    for (let door of ddDoors) {
      try {

        doors.push(new WallDocument({
          c: [
            (door.bounds[0].x * pixelsPerGrid) + offsetX,
            (door.bounds[0].y * pixelsPerGrid) + offsetY,
            (door.bounds[1].x * pixelsPerGrid) + offsetX,
            (door.bounds[1].y * pixelsPerGrid) + offsetY
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
            t: "l",
            x: ((light.position.x - file.resolution.map_origin.x) * pixelsPerGrid) + offsetX,
            y: ((light.position.y - file.resolution.map_origin.y) * pixelsPerGrid) + offsetY,
            rotation: 0,
            dim: light.range * (game.system.gridDistance || 1),
            bright: (light.range * (game.system.gridDistance || 1)) / 2,
          angle: 360,
          tintColor: "#" + light.color.substring(2),
          tintAlpha: (0.05 * light.intensity)
        })
        lights.push(newLight);
        }
        catch(e)
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
