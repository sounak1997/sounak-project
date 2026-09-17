// scripts/seedMoreDoctorsAndLabs.js
// Additive expansion of scripts/seedDoctorsAndLabs.js — more centers/doctors
// and one more lab, for catalog variety. Safe to run once; re-running would
// create duplicates (no upsert-by-name), same caveat as the grocery seed.
require('dotenv').config();
const doctorBookingService = require('../src/services/doctorBookingService');
const labTestService = require('../src/services/labTestService');

const CENTERS = [
  {
    name: 'Sunrise Health Centre',
    address: '31 Bidhan Nagar, Kolkata',
    phone: '9834455667',
    doctors: [
      {
        name: 'Dr. K. Mitra',
        specialization: 'Cardiologist',
        schedule: [
          { dayOfWeek: 1, startTime: '18:00', endTime: '21:00' }, // Mon
          { dayOfWeek: 4, startTime: '18:00', endTime: '21:00' }, // Thu
        ],
      },
      {
        name: 'Dr. S. Roy',
        specialization: 'Gynecologist',
        schedule: [
          { dayOfWeek: 2, startTime: '16:00', endTime: '19:00' }, // Tue
          { dayOfWeek: 5, startTime: '16:00', endTime: '19:00' }, // Fri
        ],
      },
    ],
  },
  {
    name: 'Green Valley Hospital',
    address: '7 Garia Main Road, Kolkata',
    phone: '9835566778',
    doctors: [
      {
        name: 'Dr. N. Banerjee',
        specialization: 'Orthopedic',
        schedule: [
          { dayOfWeek: 3, startTime: '11:00', endTime: '14:00' }, // Wed
          { dayOfWeek: 6, startTime: '11:00', endTime: '14:00' }, // Sat
        ],
      },
      {
        name: 'Dr. T. Ghosh',
        specialization: 'Dermatologist',
        schedule: [
          { dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }, // Mon
          { dayOfWeek: 3, startTime: '18:00', endTime: '20:00' }, // Wed
          { dayOfWeek: 5, startTime: '18:00', endTime: '20:00' }, // Fri
        ],
      },
      {
        name: 'Dr. M. Dutta',
        specialization: 'ENT Specialist',
        schedule: [
          { dayOfWeek: 2, startTime: '17:00', endTime: '19:00' }, // Tue
          { dayOfWeek: 4, startTime: '17:00', endTime: '19:00' }, // Thu
          { dayOfWeek: 6, startTime: '17:00', endTime: '19:00' }, // Sat
        ],
      },
    ],
  },
];

const LABS = [
  {
    name: 'City Path Labs',
    address: '19 Gariahat Road, Kolkata',
    phone: '9836677889',
    tests: [
      { name: 'Vitamin D test', price: 1200, description: '25-OH Vitamin D blood test.' },
      { name: 'HbA1c (diabetes)', price: 450, description: '3-month average blood sugar test.' },
      { name: 'Liver function test (LFT)', price: 700, description: 'Complete liver panel.' },
    ],
  },
];

async function main() {
  console.log('Seeding additional medical centers, doctors and schedules...');
  for (const c of CENTERS) {
    const center = await doctorBookingService.createCenter({ name: c.name, address: c.address, phone: c.phone });
    console.log(`  ✔ Center: ${center.name} (${center.id})`);
    for (const d of c.doctors) {
      const doctor = await doctorBookingService.createDoctor({
        centerId: center.id,
        name: d.name,
        specialization: d.specialization,
      });
      await doctorBookingService.setDoctorSchedule(doctor.id, d.schedule);
      console.log(`    ✔ Doctor: ${doctor.name} (${d.specialization}) — ${d.schedule.length} weekly slots`);
    }
  }

  console.log('Seeding additional labs and tests...');
  for (const l of LABS) {
    const lab = await labTestService.createLab({ name: l.name, address: l.address, phone: l.phone });
    console.log(`  ✔ Lab: ${lab.name} (${lab.id})`);
    for (const t of l.tests) {
      await labTestService.createTest({ labId: lab.id, name: t.name, price: t.price, description: t.description });
      console.log(`    ✔ Test: ${t.name} — ₹${t.price}`);
    }
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
