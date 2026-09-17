// scripts/seedDoctorsAndLabs.js
//
// Dummy data for the Doctors & Test Booking portal, run through the real
// service layer (same code path the admin CRUD endpoints use). Names/schedule
// match the design prototype (docs/sohay-design-flow.html) so the two stay
// consistent.
require('dotenv').config();
const doctorBookingService = require('../src/services/doctorBookingService');
const labTestService = require('../src/services/labTestService');

// day_of_week: 0=Sunday .. 6=Saturday (matches schema_doctors_tests.sql)
const CENTERS = [
  {
    name: 'Maiti Medical',
    address: '14 Lake Town Road, Kolkata',
    phone: '9830011223',
    doctors: [
      {
        name: 'Dr. A. Sen',
        specialization: 'General physician',
        schedule: [
          { dayOfWeek: 1, startTime: '17:00', endTime: '20:00' }, // Mon
          { dayOfWeek: 3, startTime: '17:00', endTime: '20:00' }, // Wed
          { dayOfWeek: 5, startTime: '17:00', endTime: '20:00' }, // Fri
        ],
      },
      {
        name: 'Dr. R. Chowdhury',
        specialization: 'Dentist',
        schedule: [
          { dayOfWeek: 2, startTime: '10:00', endTime: '13:00' }, // Tue
          { dayOfWeek: 4, startTime: '10:00', endTime: '13:00' }, // Thu
          { dayOfWeek: 6, startTime: '10:00', endTime: '13:00' }, // Sat
        ],
      },
    ],
  },
  {
    name: 'Lakeview Clinic',
    address: '22 Rashbehari Avenue, Kolkata',
    phone: '9831122334',
    doctors: [
      {
        name: 'Dr. P. Bose',
        specialization: 'Pediatrician',
        schedule: [
          { dayOfWeek: 2, startTime: '18:00', endTime: '21:00' }, // Tue
          { dayOfWeek: 4, startTime: '18:00', endTime: '21:00' }, // Thu
          { dayOfWeek: 6, startTime: '18:00', endTime: '21:00' }, // Sat
        ],
      },
    ],
  },
];

const LABS = [
  {
    name: 'Suraksha Diagnostics',
    address: '5 Park Street, Kolkata',
    phone: '9832233445',
    tests: [
      { name: 'Blood sugar (fasting)', price: 150, description: 'Fasting plasma glucose test.' },
      { name: 'Lipid profile', price: 650, description: 'Cholesterol and triglycerides panel.' },
      { name: 'Thyroid panel (T3, T4, TSH)', price: 800, description: 'Full thyroid function panel.' },
    ],
  },
  {
    name: 'Apollo Labs',
    address: '88 Salt Lake Sector V, Kolkata',
    phone: '9833344556',
    tests: [
      { name: 'Full body checkup', price: 2499, description: 'Comprehensive health screening package.' },
      { name: 'COVID RT-PCR', price: 500, description: 'RT-PCR test for COVID-19.' },
      { name: 'X-Ray (chest)', price: 350, description: 'Digital chest X-ray.' },
    ],
  },
];

async function main() {
  console.log('Seeding medical centers, doctors and schedules...');
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

  console.log('Seeding labs and tests...');
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
