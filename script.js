/* ==========================================
   EARTHSIGN TRAVEL AGENCY
   MAIN JAVASCRIPT
========================================== */


/* ==========================================
   MOBILE MENU
========================================== */

const menuToggle = document.getElementById("menu-toggle");
const navMenu = document.getElementById("nav-menu");

if (menuToggle && navMenu) {

    menuToggle.addEventListener("click", () => {
        navMenu.classList.toggle("active");
    });

    // Close mobile menu when a navigation link is clicked

    navMenu.querySelectorAll("a").forEach(link => {

        link.addEventListener("click", () => {
            navMenu.classList.remove("active");
        });

    });
}


/* ==========================================
   HEADER SCROLL EFFECT
========================================== */

const header = document.querySelector("header");

if (header) {

    window.addEventListener("scroll", () => {

        if (window.scrollY > 80) {
            header.classList.add("scrolled");
        } else {
            header.classList.remove("scrolled");
        }

    });

}


/* ==========================================
   FADE-IN SECTIONS
========================================== */

const sections = document.querySelectorAll("section");

if ("IntersectionObserver" in window) {

    const observer = new IntersectionObserver(
        (entries) => {

            entries.forEach(entry => {

                if (entry.isIntersecting) {
                    entry.target.classList.add("show");
                }

            });

        },
        {
            threshold: 0.15
        }
    );

    sections.forEach(section => {
        observer.observe(section);
    });

}


/* ==========================================
   HERO SLIDER
========================================== */

const slides = document.querySelectorAll(".slide");

let currentSlide = 0;

function showSlide(index) {

    slides.forEach(slide => {
        slide.classList.remove("active");
    });

    if (slides.length > 0) {
        slides[index].classList.add("active");
    }

}


if (slides.length > 1) {

    showSlide(currentSlide);

    setInterval(() => {

        currentSlide++;

        if (currentSlide >= slides.length) {
            currentSlide = 0;
        }

        showSlide(currentSlide);

    }, 5000);

}


/* ==========================================
   SMOOTH SCROLL
========================================== */

document.querySelectorAll('a[href^="#"]').forEach(link => {

    link.addEventListener("click", function(event) {

        const targetId = this.getAttribute("href");

        if (!targetId || targetId === "#") {
            return;
        }

        const target = document.querySelector(targetId);

        if (target) {

            event.preventDefault();

            target.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });

        }

    });

});


/* ==========================================
   CURRENT YEAR
========================================== */

const currentYear = document.getElementById("current-year");

if (currentYear) {
    currentYear.textContent = new Date().getFullYear();
}
