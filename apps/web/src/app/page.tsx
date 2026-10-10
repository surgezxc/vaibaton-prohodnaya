import Link from "next/link";

export default function Home() {
  return <main className="screen home">
    <p className="eyebrow">Строительный объект · каркас интерфейсов</p>
    <h1>Проходная</h1>
    <p className="home-intro">Выберите экран для своего устройства.</p>
    <div className="home-grid">
      <Link className="panel role-card" href="/gate"><span className="eyebrow">Планшет / компьютер</span><h2>Контролёр <span aria-hidden="true">→</span></h2><p>Открытие QR, камера КПП и результат прохода.</p></Link>
      <Link className="panel role-card" href="/phone"><span className="eyebrow">Телефон</span><h2>Рабочий <span aria-hidden="true">→</span></h2><p>Подтверждение прохода, смена и местоположение.</p></Link>
    </div>
    <aside className="demo-banner"><strong>Демонстрация интерфейса</strong><span>Вход, API и распознавание лиц пока не подключены.</span></aside>
  </main>;
}
