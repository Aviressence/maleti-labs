// GLSL sources, kept as strings rather than separate .glsl files: `fetch` is
// blocked on file:// pages, so a shader file next to index.html could never be
// read. The code is the original project's, plus the phased-array source and
// a fix for an off-by-one at the right and top edges (see the compute shader).
'use strict'

const SHADERS = Object.freeze({
// Both passes draw one full-screen quad; all the work is in the fragment shaders.
vertex: `#version 300 es
precision highp float;

in vec4 i_VertexPosition;

void main() {
  gl_Position = i_VertexPosition;
}
`,

// One time step of the wave equation. Channels: x = current value,
// y = previous value, z = accumulated energy (sum of squares).
compute: `#version 300 es
precision highp float;

uniform int u_Step;
uniform float u_Width;
uniform float u_Height;
uniform int u_Boundary;
uniform int u_InitCondition;

// Source description. Each initial-condition type reads the subset it needs.
uniform int u_Direction;    // plane wave: 0 left, 1 bottom, 2 right, 3 top
uniform int u_Shape;        // pulse / interactive: 0 circular, 1 vertical, 2 horizontal
uniform float u_SourceX;    // normalised 0..1
uniform float u_SourceY;
uniform float u_Amplitude;
uniform float u_Frequency;  // oscillation rate for the driven sources
uniform float u_Sharpness;  // gaussian falloff for the pulse sources
uniform float u_Duration;   // frames the source stays active

// Phased array: xy = position (normalised), z = phase offset (radians).
// 16 matches MAX_SOURCES in phased-array.js.
uniform vec3 u_Sources[16];
uniform int u_SourceCount;

uniform float aCeil;
uniform sampler2D u_Texture;
uniform sampler2D u_Background_Texture;
uniform float u_LOD;
uniform bool u_touchIsActive;

out vec4 o_FragColor;

const float dx = 1.0;
const float dy = 1.0;
const float dt = 0.7;

// Offset from the source, honouring the circular / vertical / horizontal shape.
vec2 sourceOffset(vec2 readId) {
  if (u_Shape == 0) {
    return readId - vec2(u_SourceX, u_SourceY) * vec2(u_Width, u_Height);
  } else if (u_Shape == 1) {
    return vec2(readId.x - u_SourceX * u_Width, 0.0);
  } else if (u_Shape == 2) {
    return vec2(0.0, readId.y - u_SourceY * u_Height);
  }
  return vec2(0.0, 0.0);
}

float pulseValue(vec2 offset) {
  float l = length(offset);
  float v = u_Amplitude * exp(-0.001 * u_Sharpness * u_LOD * l * l);
  if (u_Shape == 1 || u_Shape == 2) {
    v = v / 5.0;
  }
  return v;
}

void main() {
  vec2 readId = gl_FragCoord.xy;
  int lastFrame = int(u_Duration / u_LOD);
  bool isInitCondition = false;

  switch (u_InitCondition) {
    case 0: {
      bool pos = false;
      if (u_Direction == 0) {
        pos = readId.x < 1.0;
      } else if (u_Direction == 1) {
        pos = readId.y < 1.0;
      } else if (u_Direction == 2) {
        // Last column/row only, mirroring the first one on the other side.
        // (Was "- 2.0", which drove two columns on the right and top.)
        pos = readId.x > u_Width - 1.0;
      } else if (u_Direction == 3) {
        pos = readId.y > u_Height - 1.0;
      }
      isInitCondition = pos && u_Step <= lastFrame;
      if (isInitCondition) {
        float v = u_Amplitude * cos(float(u_Step) * u_Frequency * u_LOD);
        if (u_Step >= lastFrame - 2) {
          v = 0.0;
        }
        o_FragColor = vec4(v, v, 0.0, 1.0);
      }
      break;
    }
    case 1: {
      isInitCondition = u_Step == 0;
      if (isInitCondition) {
        float v = pulseValue(sourceOffset(readId));
        o_FragColor = vec4(v, v, 0.0, 1.0);
      }
      break;
    }
    case 2: {
      vec2 d = readId - vec2(u_SourceX, u_SourceY) * vec2(u_Width, u_Height);
      isInitCondition = length(d) < 1.0 && u_Step <= lastFrame;
      if (isInitCondition) {
        float v = u_Amplitude * cos(float(u_Step) * u_Frequency * u_LOD);
        if (u_Step >= lastFrame - 2) {
          v = 0.0;
        }
        o_FragColor = vec4(v, v, 0.0, 1.0);
      }
      break;
    }
    case 4: {
      // Several spherical sources, each driven with its own phase offset.
      if (u_Step <= lastFrame) {
        for (int i = 0; i < 16; i++) {
          if (i >= u_SourceCount) {
            break;
          }
          vec2 d = readId - u_Sources[i].xy * vec2(u_Width, u_Height);
          if (length(d) < 1.0) {
            isInitCondition = true;
            float v = u_Amplitude * cos(float(u_Step) * u_Frequency * u_LOD + u_Sources[i].z);
            if (u_Step >= lastFrame - 2) {
              v = 0.0;
            }
            o_FragColor = vec4(v, v, 0.0, 1.0);
            break;
          }
        }
      }
      break;
    }
  }

  if (!isInitCondition) {
    vec4 background = texture(u_Background_Texture, readId / vec2(u_Width, u_Height));
    float a = background.a;

    vec2 middleId = readId / vec2(u_Width, u_Height);
    vec2 rightId = (readId + vec2(1, 0)) / vec2(u_Width, u_Height);
    vec2 leftId = (readId + vec2(-1, 0)) / vec2(u_Width, u_Height);
    vec2 topId = (readId + vec2(0, -1)) / vec2(u_Width, u_Height);
    vec2 bottomId = (readId + vec2(0, 1)) / vec2(u_Width, u_Height);

    vec4 middle = texture(u_Texture, middleId);
    vec4 border;
    switch (u_Boundary) {
      case 0:
        // Unused for the edge cells themselves: see the absorbing update below.
        border = vec4(middle.y, 0.0, 0.0 , 1.0);
        break;
      case 1:
        border = vec4(middle.x, 0.0, 0.0 , 1.0);
        break;
      case 2:
        border = vec4(0);
    }
    if (texture(u_Background_Texture, middleId).a > aCeil) {
      middle = vec4(0.0);
    }
    // Cell centres sit at i + 0.5, so the edge cells are x < 1 and
    // x > width - 1. The original tested ">= width - 2", which also treated
    // the second-to-last cell as an edge and made the right and top walls
    // behave differently from the left and bottom ones.
    vec4 right = texture(u_Texture, rightId);
    if (readId.x >= u_Width - 1.0) {
      right = border;
    }
    if (texture(u_Background_Texture, rightId).a > aCeil) {
      right = vec4(0.0);
    }
    vec4 left = texture(u_Texture, leftId);
    if (readId.x <= 1.0) {
      left = border;
    }
    if (texture(u_Background_Texture, leftId).a > aCeil) {
      left = vec4(0.0);
    }
    vec4 top = texture(u_Texture, topId);
    if (readId.y <= 1.0) {
      top = border;
    }
    if (texture(u_Background_Texture, topId).a > aCeil) {
      top = vec4(0.0);
    }
    vec4 bottom = texture(u_Texture, bottomId);
    if (readId.y >= u_Height - 1.0) {
      bottom = border;
    }
    if (texture(u_Background_Texture, bottomId).a > aCeil) {
      bottom = vec4(0.0);
    }

    // laplacians
    float dfx = right.x - 2.0 * middle.x + left.x;
    float dfy = top.x - 2.0 * middle.x + bottom.x;

    // speed
    float c = 1.0 - a;

    // wave equation
    float newValue = c*c * (dfx / (dx * dx) + dfy / (dy * dy)) * dt*dt + 2.0 * middle.x - middle.y;

    float offsetValue = 0.0;
    if (u_InitCondition == 3 && u_touchIsActive) {
      offsetValue = pulseValue(sourceOffset(readId));
    }
    // Absorbing edges. The original gave the outside cell the edge cell's
    // previous value, which only matches an outgoing wave that moves exactly
    // one cell per step; at dt = 0.7 it reflected about a fifth of the wave.
    // Instead, each edge cell follows the one-way wave equation u_t + v u_n = 0
    // (upwind, v = c * dt cells per step), which lets waves leave. It is
    // stable because v < 1.
    if (u_Boundary == 0 && texture(u_Background_Texture, middleId).a <= aCeil) {
      bool edge = true;
      vec4 inner;
      if (readId.x <= 1.0) {
        inner = texture(u_Texture, rightId);
      } else if (readId.x >= u_Width - 1.0) {
        inner = texture(u_Texture, leftId);
      } else if (readId.y <= 1.0) {
        inner = texture(u_Texture, bottomId);
      } else if (readId.y >= u_Height - 1.0) {
        inner = texture(u_Texture, topId);
      } else {
        edge = false;
      }
      if (edge) {
        newValue = middle.x - c * dt * (middle.x - inner.x);
      }
    }

    newValue = newValue + offsetValue;
    o_FragColor = vec4(newValue, middle.x + offsetValue, middle.z + newValue * newValue, 1.0);
  }
}
`,

// Colours the field through the gradient texture and draws walls on top.
render: `#version 300 es
precision highp float;

uniform int u_Step;
uniform float u_Width;
uniform float u_Height;
uniform bool u_Energy;
uniform sampler2D u_Texture;
uniform sampler2D u_Background_Texture;
uniform sampler2D u_Gradient_Texture;

// View transform. The simulation itself is unaffected: this only decides which
// part of the domain is shown. u_ViewCentre is the simulation coordinate drawn
// at the middle of the canvas.
uniform float u_Zoom;
uniform vec2 u_ViewCentre;

out vec4 o_FragColor;

void main() {
  vec2 screenUV = gl_FragCoord.xy / vec2(u_Width, u_Height);
  vec2 uv = (screenUV - 0.5) / u_Zoom + u_ViewCentre;

  vec4 values = texture(u_Texture, uv);
  vec4 background = texture(u_Background_Texture, uv);
  float currentValue;
  if (u_Energy) {
    currentValue = values.z / float(u_Step);
  } else {
    currentValue = (values.x + 1.0) / 2.0;
  }
  vec4 color = texture(u_Gradient_Texture, vec2(0.0, currentValue));
  float a = background.a;
  vec4 wallColor = vec4(0.1, 0.1, 0.3, 1.0);
  color = color * (1.0 - a) + wallColor * a;
  o_FragColor = vec4(color);
}
`
})
