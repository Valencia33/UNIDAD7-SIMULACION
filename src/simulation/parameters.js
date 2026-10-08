export function createParameters() {
  return {
    // --- Modelo de Kuramoto ---
    couplingK: 0.0,              // K — fuerza de acoplamiento global
    bpm: 120,                    // Tempo en Beats Per Minute
    omegaSpread: 0.5,            // Dispersión de las frecuencias naturales (ω) por pista
    particlesPerTrack: 8,        // Agentes por pista

    // --- Espacio / cámara ---
    trackWidth: 12.0,            
    parallaxStrength: 0.5,       
    perturbationStrength: 3.14,  

    // --- Mezcla y cohesión sonora ---
    masterVolume: -4,            
    reverbWet: 0.15,             
    syncReverbBoost: 0.3,        

    // --- Umbrales para clasificar el estado colectivo ---
    orderThresholdPartial: 0.3,  
    orderThresholdStable: 0.7    
  };
}