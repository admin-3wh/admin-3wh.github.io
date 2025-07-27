// projects/shapesound/parser.js

export function parseScriptToScene(script) {
  const lines = script.split("\n").map(line => line.trim()).filter(Boolean);
  const scene = {
    canvas: { width: 800, height: 600 },
    background: "#000",
    objects: [],
    timeline: [],
    duration: 10
  };

  let inSequence = false;
  let sequenceNotes = [];

  for (let line of lines) {
    if (line === "sequence {") {
      inSequence = true;
      sequenceNotes = [];
      continue;
    }
    if (line === "}" && inSequence) {
      scene.timeline.push({ type: "sequence", notes: sequenceNotes });
      inSequence = false;
      continue;
    }
    if (inSequence) {
      sequenceNotes.push(...line.split(/\s+/));
      continue;
    }

    const parts = line.split(/\s+/);
    const cmd = parts[0];

    switch (cmd) {
      case "canvas":
        scene.canvas.width = parseInt(parts[1]);
        scene.canvas.height = parseInt(parts[2]);
        break;
      case "background":
        scene.background = parts[1];
        break;
      case "circle":
      case "rect":
      case "line": {
        const shape = { type: cmd };
        if (cmd === "circle") {
          [shape.x, shape.y, shape.r] = parts.slice(1, 4).map(Number);
        } else if (cmd === "rect") {
          [shape.x, shape.y, shape.w, shape.h] = parts.slice(1, 5).map(Number);
        } else if (cmd === "line") {
          [shape.x1, shape.y1, shape.x2, shape.y2] = parts.slice(1, 5).map(Number);
        }
        if (parts.includes("color")) {
          shape.color = parts[parts.indexOf("color") + 1];
        }
        if (parts.includes("width")) {
          shape.width = parseFloat(parts[parts.indexOf("width") + 1]);
        }
        scene.objects.push(shape);
        break;
      }
      case "sound": {
        scene.timeline.push({
          type: "tone",
          freq: parseFloat(parts[1]),
          duration: parseFloat(parts[2])
        });
        break;
      }
      case "play": {
        scene.timeline.push({ type: "note", note: parts[1] });
        break;
      }
      case "animate": {
        const shape = parts[1];
        const [x1, y1, r1] = parts.slice(2, 5).map(Number);
        const [x2, y2, r2] = parts.slice(6, 9).map(Number);
        const duration = parseFloat(parts[parts.indexOf("duration") + 1].replace("s", ""));
        scene.timeline.push({
          type: "animate",
          shape,
          x1, y1, r1,
          x2, y2, r2,
          duration
        });
        scene.duration = Math.max(scene.duration, duration);
        break;
      }
    }
  }

  return scene;
}

export function applySceneToCanvas(ctx, scene, t = 0) {
  ctx.fillStyle = scene.background || "#000";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (let obj of scene.objects) {
    switch (obj.type) {
      case "circle":
        ctx.beginPath();
        ctx.arc(obj.x, obj.y, obj.r, 0, 2 * Math.PI);
        ctx.fillStyle = obj.color || "#FFF";
        ctx.fill();
        break;
      case "rect":
        ctx.fillStyle = obj.color || "#FFF";
        ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
        break;
      case "line":
        ctx.strokeStyle = obj.color || "#FFF";
        ctx.lineWidth = obj.width || 1;
        ctx.beginPath();
        ctx.moveTo(obj.x1, obj.y1);
        ctx.lineTo(obj.x2, obj.y2);
        ctx.stroke();
        break;
    }
  }

  // Future: update based on t for animated elements
}
