# Crucigrama de a dos

Crucigrama y sopa de letras **nuevos cada día**, con cultura argentina, para jugar en el celu o la compu y competir por tiempo y puntos.

- **Crucigrama grande**: ~30 palabras por día (unas 15 horizontales y 15 verticales) en una grilla de hasta 19×19, con botón de zoom en el celu.
- **Mismo juego para los dos**: el puzzle sale de la fecha, así que ambos reciben el mismo sin servidor.
- **Puntos**: crucigrama 150 y sopa 60, más hasta +50% por velocidad; cada pista resta 8. Ranking semanal (lunes a domingo) y total.
- **Se instala** en el celu (PWA) y guarda tu progreso si cerrás la app.

## Correr

    npm install
    npm run dev     # desarrollo
    npm test        # tests
    npm run build   # versión para publicar (carpeta dist/)

## Sumar tus propias pistas

Editá `src/lib/bank.ts`: cada entrada es `{ a: 'RESPUESTA', c: 'Pista' }` (mayúsculas, sin tildes ni espacios ni Ñ). Cosas que sepan ustedes dos entran solas en los juegos.

## Ranking en vivo con tu novio (Supabase, gratis)

1. Creá un proyecto en supabase.com y corré esto en *SQL Editor*:

       create table scores (
         room text not null, player text not null, day text not null,
         game text not null, seconds int not null, points int not null,
         primary key (room, player, day, game)
       );
       alter table scores enable row level security;
       create policy "leer" on scores for select using (true);
       create policy "anotar" on scores for insert with check (true);

2. Creá `.env.local` con la URL y la clave *anon* del proyecto:

       VITE_SUPABASE_URL=https://xxxx.supabase.co
       VITE_SUPABASE_ANON_KEY=eyJ...

3. Publicá `dist/` (GitHub Pages, Netlify o Vercel) y abrilo en los dos celulares. Cada uno pone su nombre y **el mismo código de sala**.

Sin Supabase la app funciona igual; al terminar, el botón *Mandar mi resultado* arma un mensaje para WhatsApp.
