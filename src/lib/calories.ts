// Calorie ESTIMATE from the ACSM walking and running equations.
// Oxygen cost in ml/kg/min, with speed in metres per minute and grade as a fraction:
//   walking: 3.5 + 0.1 * speed + 1.8 * speed * grade
//   running: 3.5 + 0.2 * speed + 0.9 * speed * grade
// About 5 kcal are burned per litre of oxygen.

const RUN_FROM_KMH = 7;

export function kcalPerMinute(kmh: number, weightKg: number, inclinePct = 0) {
  if (kmh <= 0 || weightKg <= 0) return 0;
  const speed = (kmh * 1000) / 60;
  const grade = Math.max(0, inclinePct) / 100;
  const vo2 = kmh < RUN_FROM_KMH ? 3.5 + 0.1 * speed + 1.8 * speed * grade : 3.5 + 0.2 * speed + 0.9 * speed * grade;
  return (vo2 * weightKg * 5) / 1000;
}
