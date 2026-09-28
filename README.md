# Portfolio + Backend

My personal portfolio site built with React and FastAPI. First real project — been meaning to do this properly for a while.

## What It Is

A portfolio site that actually has a backend. React frontend fetches project data from a FastAPI API instead of hardcoding everything. Small thing but it means I can update projects from one place.

Also has a typewriter effect in the hero section that I wrote myself using `useState` and `useEffect`. Took longer than I expected but I finally get how stale closures work now.

## What I Built Myself

- Typewriter effect in Hero.jsx — full useState + useEffect logic, stale closure fix, delete animation, pause on complete
- Projects.jsx fetch call — useEffect + fetch + state management
- FastAPI backend — /projects and /resume endpoints with CORS
- All hook logic, API endpoints, and data flow written by hand (CSS and boilerplate was AI-assisted)

## Stack

- React (Vite) — Frontend
- FastAPI + Uvicorn — Backend API
- Python — Backend logic
- Deployed frontend on GitHub Pages

## Running It Locally

You need two terminals.

**Backend:**
```bash
cd backend
pip install fastapi uvicorn
python -m uvicorn main:app --reload
```
API runs at `http://localhost:8000`

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```
Site runs at `http://localhost:5173`

## API Endpoints

- `GET /projects` — Returns all my projects as JSON
- `GET /resume` — Returns my resume data in machine-readable format (Agent Resume standard)

## What I Learned

- How `useEffect` actually works (and why stale closures in `setInterval` are a thing)
- The `prev =>` functional update pattern — crucial for intervals
- How CORS works and why you need it when your frontend and backend run on different ports
- FastAPI basics — routes, returning JSON
- How a React frontend talks to a Python backend

## Structure

```
portfolio/
  frontend/        # React + Vite app
    src/
      components/  # Navbar, Hero, About, Skills, Projects, Contact
      App.jsx
      index.css
  backend/         # FastAPI
    main.py
```

---

Built during my summer break between 2nd and 3rd year at PES University Bangalore.
