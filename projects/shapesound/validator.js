// projects/shapesound/validator.js
// Minimal, fast, no-deps DSL validator.
// Goal: catch obvious syntax errors before running the engine.

export function validateDSL(text) {
  const lines = text.split(/\r?\n/);
  const errors = [];
  const cleaned = [];

  // Basic patterns
  const HEX = /^#[0-9A-F]{6}$/i;
  const NUM = /^-?\d+(\.\d+)?$/;
  const CMD = /^(canvas|background|tempo|circle|rect|line|sound|play|sequence|sprite|spriteimg|asset|animate|delay|physics|gravity|damping|bounds|setvel|impulse|path|playframes|stopframes|setfps|wiggle)\b/;

  // Structural checks
  let seqDepth = 0;

  function err(i, msg) {
    errors.push(`Line ${i + 1}: ${msg}`);
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    cleaned.push(line);

    // sequence block braces
    if (line === "sequence {") { seqDepth++; continue; }
    if (line === "}")         { if (seqDepth === 0) err(i, "Unexpected '}'"); else seqDepth--; continue; }

    // command known?
    if (!CMD.test(line)) {
      err(i, `Unknown or malformed command: "${line.split(/\s+/)[0]}"`);
      continue;
    }

    const parts = line.split(/\s+/);
    const cmd = parts[0];

    // spot checks per command
    try {
      switch (cmd) {
        case "canvas": {
          if (!(NUM.test(parts[1]) && NUM.test(parts[2]))) err(i, "canvas expects: canvas WIDTH HEIGHT");
          break;
        }
        case "background": {
          if (!HEX.test(parts[1])) err(i, "background expects hex color like #112233");
          break;
        }
        case "tempo": {
          if (!(NUM.test(parts[1]) && parseFloat(parts[1]) > 0)) err(i, "tempo expects positive number");
          break;
        }
        case "circle": {
          // circle x y r [color #RRGGBB]
          if (!(NUM.test(parts[1]) && NUM.test(parts[2]) && NUM.test(parts[3]))) err(i, "circle expects x y r");
          const cIdx = parts.indexOf("color");
          if (cIdx !== -1 && !HEX.test(parts[cIdx + 1])) err(i, "circle color must be #RRGGBB");
          break;
        }
        case "rect": {
          if (!(NUM.test(parts[1]) && NUM.test(parts[2]) && NUM.test(parts[3]) && NUM.test(parts[4])))
            err(i, "rect expects x y w h");
          const cIdx = parts.indexOf("color");
          if (cIdx !== -1 && !HEX.test(parts[cIdx + 1])) err(i, "rect color must be #RRGGBB");
          break;
        }
        case "line": {
          if (!(NUM.test(parts[1]) && NUM.test(parts[2]) && NUM.test(parts[3]) && NUM.test(parts[4])))
            err(i, "line expects x1 y1 x2 y2");
          const wIdx = parts.indexOf("width");
          if (wIdx !== -1 && !NUM.test(parts[wIdx + 1])) err(i, "line width must be number");
          const cIdx = parts.indexOf("color");
          if (cIdx !== -1 && !HEX.test(parts[cIdx + 1])) err(i, "line color must be #RRGGBB");
          break;
        }
        case "sound": {
          if (!(NUM.test(parts[1]) && NUM.test(parts[2]))) err(i, "sound expects freq seconds");
          break;
        }
        case "play": {
          // allow any token; your engine filters unknown notes at runtime
          if (!parts[1]) err(i, "play expects a note like C4");
          break;
        }
        case "delay": {
          if (!(NUM.test(parts[1]) && parseFloat(parts[1]) >= 0)) err(i, "delay expects milliseconds >= 0");
          break;
        }
        case "animate": {
          // animate circle x y r -> X Y R duration 5s [fromColor #.. toColor #..] [ease in|out|in-out|linear]
          const arrow = parts.indexOf("->");
          const dur   = parts.indexOf("duration");
          if (arrow === -1 || dur === -1) err(i, "animate needs '->' and 'duration Ns'");
          const shape = parts[1];
          if (shape === "sprite") {
            if (!parts[2]) err(i, "animate sprite requires id");
          } else if (!["circle","rect","line"].includes(shape)) {
            // allow your other shapes too
          }
          const dTok = parts[dur + 1] || "";
          if (!/^\d+(\.\d+)?s$/.test(dTok)) err(i, "duration must be like 5s");
          const fc = parts.indexOf("fromColor"); if (fc !== -1 && !HEX.test(parts[fc + 1])) err(i, "fromColor must be #RRGGBB");
          const tc = parts.indexOf("toColor");   if (tc !== -1 && !HEX.test(parts[tc + 1])) err(i, "toColor must be #RRGGBB");
          const ez = parts.indexOf("ease");      if (ez !== -1 && !/^(linear|in|out|in-out)$/i.test(parts[ez + 1] || "")) err(i, "ease must be linear|in|out|in-out");
          break;
        }
        case "physics": {
          if (!/^(on|off)$/i.test(parts[1] || "")) err(i, "physics expects on|off");
          break;
        }
        case "gravity": {
          if (!(NUM.test(parts[1]) && NUM.test(parts[2]))) err(i, "gravity expects gx gy");
          break;
        }
        case "damping": {
          if (!(NUM.test(parts[1]) && parseFloat(parts[1]) > 0 && parseFloat(parts[1]) <= 1.0)) err(i, "damping expects 0<d<=1");
          break;
        }
        case "bounds": {
          if (!/^(canvas|none)$/i.test(parts[1] || "")) err(i, "bounds expects canvas|none");
          break;
        }
        case "setvel":
        case "impulse": {
          if (!parts[1]) err(i, `${cmd} requires sprite id`);
          if (!(NUM.test(parts[2]) && NUM.test(parts[3]))) err(i, `${cmd} expects vx vy`);
          break;
        }
        case "path": {
          // path id (x1,y1) -> (x2,y2) duration 5s [ease ...]
          const arrow = parts.indexOf("->");
          const dur   = parts.indexOf("duration");
          if (!parts[1]) err(i, "path requires id");
          if (arrow === -1 || dur === -1) err(i, "path needs '->' and 'duration Ns'");
          const dTok = parts[dur + 1] || "";
          if (!/^\d+(\.\d+)?s$/.test(dTok)) err(i, "duration must be like 5s");
          break;
        }
        case "asset": {
          // asset image key "src" | asset spritesheet key action "src" frame WxH frames N [fps M]
          if (!/(image|spritesheet)/.test(parts[1] || "")) err(i, "asset kind must be image|spritesheet");
          if (!/".*"/.test(line)) err(i, "asset needs quoted path");
          break;
        }
        case "sprite":
        case "spriteimg":
        case "playframes":
        case "stopframes":
        case "setfps":
        case "wiggle":
          // Allow; detailed checks happen at runtime
          break;
      }
    } catch (e) {
      err(i, e.message);
    }
  }

  if (seqDepth !== 0) errors.push("Unclosed sequence block 'sequence {'");

  return {
    ok: errors.length === 0,
    errors,
    cleanedText: cleaned.join("\n")
  };
}
