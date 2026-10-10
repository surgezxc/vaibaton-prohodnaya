import Link from "next/link";
import { Shell } from "@/components/shell";

const cards = [
  {
    href: "/gate",
    who: "Контролёр",
    device: "Планшет или ноутбук",
    text: "Вход или выход, одноразовый QR и один кадр с камеры КПП.",
  },
  {
    href: "/phone",
    who: "Рабочий",
    device: "Телефон",
    text: "Скан QR, подпись этого телефона и кнопки симуляции зоны.",
  },
  {
    href: "/admin",
    who: "Кадры",
    device: "Компьютер",
    text: "Карточка человека, фото-эталон и журнал попыток.",
  },
  {
    href: "/manager",
    who: "Руководитель",
    device: "Компьютер",
    text: "Кто сейчас на объекте и с какого времени.",
  },
];

export default function Home() {
  return (
    <Shell>
      <p className="text-xs font-bold tracking-widest text-emerald-900 uppercase">Строительный объект</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">Проходная</h1>
      <p className="mt-2 max-w-xl text-stone-600">Четыре экрана одного стенда. Пропуск решает сервер, браузер только показывает его ответ.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="rounded-2xl border border-stone-200 bg-white p-5 no-underline hover:border-emerald-800">
            <p className="text-xs font-semibold tracking-wide text-emerald-900 uppercase">{card.device}</p>
            <h2 className="mt-2 text-2xl font-semibold">{card.who}</h2>
            <p className="mt-2 text-sm text-stone-600">{card.text}</p>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
