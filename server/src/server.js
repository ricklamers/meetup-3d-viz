const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static(__dirname + "/../public"));

let players = {};
// spec: {x: Number, y: Number, angle: Number, name: string, uuid: string, socket_id: string}

io.on("connection", (socket) => {
  socket.on("disconnect", () => {
    // Find player based on socket.id
    for (let uuid of Object.keys(players)) {
      let player = players[uuid];
      if (player.socket_id == socket.id) {
        console.log("a user disconnected " + uuid);
        socket.broadcast.emit("player_left", uuid);
        delete players[uuid];
      }
    }
  });

  socket.on("enter", ({ name, social, uuid }) => {
    console.log("a user connected " + uuid);

    players[uuid] = {
      name,
      uuid,
      social,
      x: 0,
      y: 0,
      angle: 0,
      socket_id: socket.id,
    };

    // Send initial positions
    for (let uuid of Object.keys(players)) {
      let player = players[uuid];
      socket.emit("update", {
        uuid,
        x: player.x,
        y: player.y,
        angle: player.angle,
        name: player.name,
        social: player.social
      });
    }
  });

  socket.on("update", ({ x, y, angle, uuid }) => {
    if (players[uuid] === undefined) {
      console.log("Warning: got update for player not in players");
      return;
    }

    // Update server struct
    players[uuid] = {
      ...players[uuid],
      x,
      y,
      angle,
    };

    socket.broadcast.emit("update", {
      x,
      y,
      angle,
      uuid,
      name: players[uuid].name,
      social: players[uuid].social,
    });
  });
});


server.listen(3000, () => {
  console.log("listening on *:3000");
});
