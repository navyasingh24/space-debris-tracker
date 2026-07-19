export function latLonToVector3(
    lat,
    lon,
    radius,
    altitude = 0
  ) {
  
    const phi =
      (90 - lat) * (Math.PI / 180);
  
    const theta =
      (lon + 180) * (Math.PI / 180);
  
    const r = radius + altitude;
  
    const x =
      -r * Math.sin(phi) * Math.cos(theta);
  
    const z =
      r * Math.sin(phi) * Math.sin(theta);
  
    const y =
      r * Math.cos(phi);
  
    return { x, y, z };
  }