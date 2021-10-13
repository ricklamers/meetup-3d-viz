import "./main.css";

import * as THREE from "three";

import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import QRCode from "qrcode";
import { io } from "socket.io-client";
import { v4 } from "uuid";

(() => {
  const client = io();
  let playerUUID;
  let playersLoading = [];
  let playerObjects = {};

  let camera, scene, renderer;
  let playerMesh;
  let clock;

  // Controller variables
  const joystickRadius = 150;
  const PLAYER_TIMEOUT = 5000; // in ms
  const FONT_SIZE = 32;

  let joystickEl;
  let joystickMoveEl;
  let controlActive = false;
  let centerLocation;
  let playerSpeed = 0;
  let playerAngle = 0;
  let speedConstant = 1e-2 * 2;
  // End of controller vars

  let addQRCode = () => {
    QRCode.toDataURL(window.location.origin, function (err, url) {
      let div = document.createElement("div");
      div.innerHTML = "<img src='" + url + "' class='qr-code' />";
      document.body.appendChild(div);
    });
  };

  let checkInactivePlayers = () => {
    let now = new Date();
    for (let uuid of Object.keys(playerObjects)) {
      if (uuid == playerUUID) {
        continue;
      }

      if (
        now.getTime() - playerObjects[uuid].lastUpdate.getTime() >
        PLAYER_TIMEOUT
      ) {
        console.log("Removed " + uuid + " for idleness.");
        removePlayer(uuid);
      }
    }
  };

  let companyLogoObj;

  // Welcome screen
  let hookupWelcomeScreen = () => {
    document
      .querySelector(".welcome-screen button")
      .addEventListener("click", join);
  };

  let listOpen = false;
  let toggleList = () => {
    let socialList = document.querySelector(".social-list");
    let button = document.querySelector(".social-list button");
    if (listOpen) {
      // Action: close
      socialList.classList.remove("open");

      button.innerHTML = "Open";
    } else {
      // Action: open
      socialList.classList.add("open");

      button.innerHTML = "Close";
    }
    listOpen = !listOpen;
  };

  let hookupListScreen = () => {
    document
      .querySelector(".social-list button")
      .addEventListener("touchend", toggleList);
  };

  hookupListScreen();

  let join = () => {
    let inputField: HTMLInputElement = document.querySelector(
      ".welcome-screen input[name='fullname']"
    );
    let name = inputField.value;
    if (name.length == 0) {
      alert("Please fill in your name.");
      return;
    }

    let socialInputField: HTMLInputElement = document.querySelector(
      ".welcome-screen input[name='social']"
    );
    let social = socialInputField.value;
    if (social.length == 0) {
      alert("Please fill in a social link where people can look you up.");
      return;
    }

    enterServer(name, social);

    document.querySelector(".welcome-screen").remove();
  };

  let enterServer = (name, social) => {
    let uuid = v4();
    playerUUID = uuid;

    loadPlayer(name).then((_playerMesh: THREE.Object3D) => {
      playerMesh = _playerMesh;
      handleLoadPlayer(uuid, name, social, _playerMesh);
    });

    client.emit("enter", {
      name,
      social,
      uuid,
    });
  };

  let refreshPlayerList = () => {
    let ul = document.querySelector(".social-list ul");
    ul.innerHTML = "";

    for (let uuid of Object.keys(playerObjects)) {
      let li = document.createElement("li");
      li.innerHTML = `<span>${playerObjects[uuid].name}</span><br><a href="${playerObjects[uuid].social}">${playerObjects[uuid].social}</a>`;

      ul.appendChild(li);
    }
  };

  client.on("connect", () => {

    hookupWelcomeScreen();

    if (window.location.search.indexOf("host") > -1) {
      addQRCode();
      document.querySelector<HTMLElement>(".welcome-screen").style.display = 'none';
      document.querySelector<HTMLElement>(".social-list").style.display = 'none';
      enterServer("Server", "");
    }
  });

  function removePlayer(uuid) {
    if (uuid == playerUUID) {
      // Can't remove self
      return;
    }
    if (playerObjects[uuid] === undefined) {
      console.log("Player left that wasn't loaded");
      return;
    }

    scene.remove(playerObjects[uuid].mesh);
    delete playerObjects[uuid];
  }

  client.on("player_left", (uuid) => {
    removePlayer(uuid);
  });

  client.on("update", ({ x, y, angle, uuid, name, social }) => {
    // Skip updates about self
    if (playerUUID == uuid) return;

    if (
      playerObjects[uuid] === undefined &&
      !playersLoading[uuid] &&
      uuid != playerUUID
    ) {
      playersLoading[uuid] = true;
      console.log("Loading player " + uuid);
      loadPlayer(name).then(
        handleLoadPlayer.bind(undefined, uuid, name, social)
      );
    }
    // Known player
    if (playerObjects[uuid]) {
      playerObjects[uuid].lastUpdate = new Date();

      updatePlayerMesh(playerObjects[uuid].mesh, angle, x, y);
    }
  });

  let computePlayerAngle = (playerAngle) => {
    return -playerAngle + Math.PI / 2;
  };

  let handleLoadPlayer = (
    uuid: string,
    name: string,
    social: string,
    playerMesh: THREE.Object3D,
  ) => {
    playerObjects[uuid] = {
      mesh: playerMesh,
      lastUpdate: new Date(),
      name: name,
      social: social,
    };

    scene.add(playerMesh);
    playersLoading[uuid] = false;

    // Side effect
    refreshPlayerList();
  };

  init();

  function init() {
    clock = new THREE.Clock();

    camera = new THREE.PerspectiveCamera(
      36,
      window.innerWidth / window.innerHeight,
      0.01,
      100
    );
    camera.position.z = 7;
    camera.position.y = -15;

    scene = new THREE.Scene();

    // Position camera
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    const light = new THREE.SpotLight(0xffffff);
    scene.add(light);
    light.position.set(0, -5, 5);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animation);
    renderer.setClearColor(0xeeeeee, 1);
    renderer.setPixelRatio(
      window.devicePixelRatio ? window.devicePixelRatio : 1
    );
    document.body.appendChild(renderer.domElement);

    // Load Orchest logo
    loadGLTF("objects/company-logo.glb", function (gltf) {
      scene.add(gltf.scene);
      companyLogoObj = gltf;

      // Correct orientation
      companyLogoObj.scene.rotation.set(0, 0, -0.2);
      const logoScale = 1;
      companyLogoObj.scene.scale.set(logoScale, logoScale, logoScale);
      companyLogoObj.scene.position.x += 4;
      companyLogoObj.scene.position.y += 7;

    });

    // Load DS logo
    loadGLTF("objects/ds-logo.glb", function (gltf) {
      scene.add(gltf.scene);
      companyLogoObj = gltf;

      // Correct orientation
      const logoScale = 1;
      companyLogoObj.scene.rotation.set(Math.PI / 2, 0.2, 0);
      companyLogoObj.scene.scale.set(logoScale, logoScale, logoScale);
      companyLogoObj.scene.position.z += logoScale;
      companyLogoObj.scene.position.x -= 4;
      companyLogoObj.scene.position.y += 7;

    });

    // start inactivity loop
    setInterval(checkInactivePlayers, 1000);
  }

  function generateTextPlane(text) {
    let textHeight = FONT_SIZE;

    var canvas = document.createElement("canvas");
    var context = canvas.getContext("2d");
    context.font = "normal " + textHeight + "px Arial";
    let metrics = context.measureText(text);
    var textWidth = metrics.width;

    canvas.width = textWidth;
    canvas.height = textHeight;
    context.font = "normal " + textHeight + "px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#000000";
    context.fillText(text, textWidth / 2, textHeight / 2);

    var texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    var material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      map: texture,
      transparent: true,
    });
    var geometry = new THREE.PlaneGeometry(
      (textWidth / textHeight) * (FONT_SIZE / 128),
      FONT_SIZE / 128
    );
    let plane = new THREE.Mesh(geometry, material);

    plane.rotation.set(Math.PI / 2, 0, 0);

    let group = new THREE.Group();
    group.add(plane);
    return group;
  }

  function loadPlayer(name) {
    return new Promise<THREE.Object3D>((resolve, _) => {
      loadGLTF("objects/figure.glb", function (gltf) {
        scene.add(gltf.scene);

        // Correct orientation
        gltf.scene.rotation.set(0, 0, Math.PI);

        const scale = 0.3;
        gltf.scene.scale.set(scale, scale, scale);

        let group = new THREE.Group();
        let nameObject = generateTextPlane(name);
        nameObject.scale.set(1, 1, 1);
        nameObject.position.set(0, 0, 1.5);
        group.add(gltf.scene);
        group.add(nameObject);

        if (name == "Server") {
          group.visible = false;
        }

        group.userData.nameObject = nameObject;

        resolve(group);
      });
    });
  }

  function loadGLTF(path, cb) {
    const loader = new GLTFLoader();
    loader.load(path, cb, undefined, function (error) {
      console.error(error);
    });
  }

  function updatePlayerMesh(playerMesh, playerAngle, x, y) {
    playerMesh.position.x = x;
    playerMesh.position.y = y;

    playerMesh.rotation.set(0, 0, computePlayerAngle(playerAngle));
    playerMesh.userData.nameObject.rotation.set(
      0,
      0,
      -computePlayerAngle(playerAngle)
    );
  }

  function animation() {
    if (playerMesh) {
      const delta = clock.getDelta();

      updatePlayerMesh(
        playerMesh,
        playerAngle,
        playerMesh.position.x +
          Math.cos(playerAngle) * (delta * playerSpeed) * speedConstant,
        playerMesh.position.y -
          Math.sin(playerAngle) * (delta * playerSpeed) * speedConstant
      );

      // Update own position
      if (client && client.connected && controlActive) {
        client.emit("update", {
          angle: playerAngle,
          x: playerMesh.position.x,
          y: playerMesh.position.y,
          uuid: playerUUID,
        });
      }

      camera.position.x = playerMesh.position.x;
      camera.position.y = playerMesh.position.y - 15;

      renderer.render(scene, camera);
    }
  }

  document.body.addEventListener("touchstart", (e: TouchEvent) => {
    let targetEl:any = e.target;
    if(targetEl.tagName != "CANVAS") {
      return
    }
    
    controlActive = true;

    centerLocation = [e.touches[0].clientX, e.touches[0].clientY];

    // create center joystick
    joystickEl = document.createElement("div");
    joystickEl.classList.add("joystick-center");
    joystickEl.style.transform =
      "translateX(" +
      centerLocation[0] +
      "px) translateY(" +
      centerLocation[1] +
      "px)";
    document.body.appendChild(joystickEl);

    // create moving joystick part
    joystickMoveEl = document.createElement("div");
    joystickMoveEl.classList.add("joystick-move");
    joystickMoveEl.style.transform =
      "translateX(" +
      centerLocation[0] +
      "px) translateY(" +
      centerLocation[1] +
      "px)";
    document.body.appendChild(joystickMoveEl);
  });

  document.body.addEventListener("touchmove", (e) => {
    let touchLocation = [e.touches[0].clientX, e.touches[0].clientY];

    // Limit location to radius circle around centerLocation
    let relativeTouchLocation = [
      touchLocation[0] - centerLocation[0],
      touchLocation[1] - centerLocation[1],
    ];

    let angle = Math.atan2(relativeTouchLocation[1], relativeTouchLocation[0]);
    let vectorSize = Math.min(
      joystickRadius,
      Math.sqrt(
        Math.pow(relativeTouchLocation[0], 2) +
          Math.pow(relativeTouchLocation[1], 2)
      )
    );

    let vectorPosition = [
      vectorSize * Math.cos(angle),
      vectorSize * Math.sin(angle),
    ];
    let translatedVectorPosition = [
      vectorPosition[0] + centerLocation[0],
      vectorPosition[1] + centerLocation[1],
    ];

    joystickMoveEl.style.transform =
      "translateX(" +
      translatedVectorPosition[0] +
      "px) translateY(" +
      translatedVectorPosition[1] +
      "px)";

    // Capture globals for controls
    playerAngle = angle;
    playerSpeed = vectorSize;
  });

  document.body.addEventListener("touchend", () => {
    controlActive = false;

    playerSpeed = 0;

    if (joystickEl) {
      document.body.removeChild(joystickEl);
      document.body.removeChild(joystickMoveEl);
      joystickEl = undefined;
      joystickMoveEl = undefined;
    }
  });
})();
