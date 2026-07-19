export async function fetchTLE() {

    // ISS + popular satellites from Celestrak
    const url = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle";
  
    const res = await fetch(url);
    const text = await res.text();
  
    const lines = text.split("\n");
  
    const sats = [];
  
    for (let i = 0; i < lines.length; i += 3) {
  
      const name = lines[i]?.trim();
      const tle1 = lines[i + 1]?.trim();
      const tle2 = lines[i + 2]?.trim();
  
      if (name && tle1 && tle2) {
        sats.push({ name, tle1, tle2 });
      }
    }
  
    return sats;
  }