(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AutoEditColor = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const controls = {
    temperature: { label: 'Temperature', min: -100, max: 100, step: 1, value: 0 },
    tint: { label: 'Tint', min: -100, max: 100, step: 1, value: 0 },
    exposure: { label: 'Exposure', min: -5, max: 5, step: 0.1, value: 0 },
    contrast: { label: 'Contrast', min: -100, max: 100, step: 1, value: 0 },
    highlights: { label: 'Highlights', min: -100, max: 100, step: 1, value: 0 },
    shadows: { label: 'Shadows', min: -100, max: 100, step: 1, value: 0 },
    whites: { label: 'Whites', min: -100, max: 100, step: 1, value: 0 },
    blacks: { label: 'Blacks', min: -100, max: 100, step: 1, value: 0 },
    saturation: { label: 'Saturation', min: 0, max: 200, step: 1, value: 100 }
  };
  const defaults = Object.freeze(Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.value])));

  function valid(value) {
    return Boolean(value && Object.keys(value).length === Object.keys(controls).length
      && Object.entries(controls).every(([key, control]) => Number.isFinite(value[key]) && value[key] >= control.min && value[key] <= control.max));
  }

  function adjusted(value) {
    return Boolean(value && Object.keys(defaults).some((key) => value[key] !== defaults[key]));
  }

  let processor = null;
  function createProcessor() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('Color correction requires WebGL. Enable GPU acceleration or reset the source color settings.');
    const shader = (type, source) => {
      const result = gl.createShader(type);
      gl.shaderSource(result, source);
      gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(`Color shader failed: ${gl.getShaderInfoLog(result)}`);
      return result;
    };
    const vertex = shader(gl.VERTEX_SHADER, `
      attribute vec2 position;
      varying vec2 uv;
      void main() { uv = (position + 1.0) * 0.5; gl_Position = vec4(position, 0.0, 1.0); }
    `);
    const fragment = shader(gl.FRAGMENT_SHADER, `
      precision highp float;
      varying vec2 uv;
      uniform sampler2D image;
      uniform float temperature, tint, exposure, contrast, highlights, shadows, whites, blacks, saturation;
      void main() {
        vec3 rgb = texture2D(image, uv).rgb;
        rgb *= exp2(vec3(temperature * 0.35, -tint * 0.35, -temperature * 0.35));
        rgb = pow(pow(max(rgb, vec3(0.0)), vec3(2.2)) * exp2(exposure), vec3(1.0 / 2.2));
        rgb = max(vec3(0.0), (rgb - 0.18) * (1.0 + contrast) + 0.18);
        float light = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
        float bright = smoothstep(0.35, 0.9, light);
        float dark = 1.0 - smoothstep(0.05, 0.65, light);
        rgb += vec3(highlights * bright * 0.3 + shadows * dark * 0.25
          + whites * smoothstep(0.65, 1.0, light) * 0.3
          + blacks * (1.0 - smoothstep(0.0, 0.3, light)) * 0.2);
        light = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
        rgb = mix(vec3(light), rgb, saturation);
        gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
      }
    `);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Color program failed: ${gl.getProgramInfoLog(program)}`);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
    const uniforms = Object.fromEntries(Object.keys(controls).map((key) => [key, gl.getUniformLocation(program, key)]));
    return { canvas, gl, uniforms };
  }

  function render(context, source, value, x, y, width, height) {
    if (value && !valid(value)) throw new Error('Invalid source color settings.');
    if (!adjusted(value)) {
      context.drawImage(source, x, y, width, height);
      return;
    }
    if (!processor) processor = createProcessor();
    const { canvas, gl, uniforms } = processor;
    if (gl.isContextLost()) throw new Error('The color rendering GPU context was lost. Restart AutoEdit before previewing or exporting graded footage.');
    const outputWidth = Math.max(1, Math.round(width));
    const outputHeight = Math.max(1, Math.round(height));
    if (canvas.width !== outputWidth) canvas.width = outputWidth;
    if (canvas.height !== outputHeight) canvas.height = outputHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
    for (const key of Object.keys(controls)) gl.uniform1f(uniforms[key], key === 'exposure' ? value[key] : value[key] / 100);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`Color rendering failed (WebGL error ${error}).`);
    context.drawImage(canvas, x, y, width, height);
  }

  return { controls, defaults, valid, adjusted, render };
});
