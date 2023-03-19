require("dotenv").config();
const path = require("path");
const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, { path: "/log-socket/" });

const port = process.env.SERVER_PORT || 3010;
const stage = process.env.NODE_ENV || "unknown";

// Map of [teamId, {teamMembers: Map({userId, role}), secret: string, lastAction: Date}]
const teams = new Map();

// Map of [userId, socket.id]
const connections = new Map();

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "/index.html"));
});

io.on("connection", (socket) => {
  const connectionInfo = { socketId: socket.id, userId: null };
  // io.sockets.sockets is Map
  const socketIds = io.sockets.sockets.keys();
  console.log(socketIds);

  // join
  socket.on("join", (credentials) => {
    const { team, userId, secret } = credentials;
    if (stage === "development") console.log(team, userId, secret);
    connectionInfo.userId = userId;
    connections.set(userId, socket.id);
    const existingTeam = teams.get(team);
    if (!existingTeam) {
      const teamMembers = new Map();
      teamMembers.set(userId, { role: "owner" });
      teams.set(team, {
        teamMembers,
        secret,
        lastAction: new Date(),
      });
      if (stage === "development") console.log("team created", teams.get(team));
      socket.emit("message", "team created");
      return;
    }
    if (secret !== existingTeam.secret) {
      socket.emit("error", { message: "not allowed to join" });
      return;
    }
    const { teamMembers } = existingTeam;
    teamMembers.set(userId, { role: "operator" });
    socket.emit("message", Object.keys(teamMembers.keys()).join(", "));
  });

  // sync the state
  socket.on("sync", (rawData) => {
    const { team, userId, state } = rawData;
    if (stage === "development") console.log(team, userId, state);
    if (!team || !userId) {
      socket.emit("error", {
        message: "wrong socket event: no team or userId",
      });
    }
    const requestedTeam = teams.get(team);
    if (!requestedTeam) {
      socket.emit("error", { message: "team doesn't exist" });
      return;
    }
    const { teamMembers } = requestedTeam;
    if (!teamMembers?.has(userId)) {
      socket.emit("error", { message: "not a team member" });
      return;
    }
    const restMembers = [...teamMembers.keys()].filter((id) => id !== userId);
    restMembers.forEach((userId) => {
      const socketId = connections.get(userId);
      if (stage === "development") console.log("memberSocketId", socketId);
      const memberSocket = io.sockets.sockets.get(socketId);
      if (memberSocket) {
        memberSocket.emit("state/sync", JSON.stringify(state));
      }
    });
  });

  // disconnect
  socket.on("disconnect", () => {
    if (connectionInfo.userId) {
      connections.delete(connectionInfo.userId);
    }
    if (stage === "development")
      console.log(`${connectionInfo.userId} (${socket.id}) disconnected`);
  });
});

server.listen(port, () => {
  if (stage === "development") console.log(`listening on *:${port}`);
});
