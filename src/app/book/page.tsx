import { BookingForm } from "./booking-form";

// The project board owns /. Keep the existing booking module on its own page.
export default function BookPage() {
  return (
    <main className="board">
      <h1>Book a time</h1>
      <BookingForm />
    </main>
  );
}
