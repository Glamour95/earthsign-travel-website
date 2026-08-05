// Mobile Menu

const menuToggle = document.getElementById("menu-toggle");
const navMenu = document.getElementById("nav-menu");

menuToggle.addEventListener("click", () => {

    navMenu.classList.toggle("active");

});

// Header Scroll

window.addEventListener("scroll", () => {

    document.querySelector("header").classList.toggle("scrolled", window.scrollY > 80);

});

// Fade In Sections

const observer = new IntersectionObserver((entries)=>{

entries.forEach(entry=>{

if(entry.isIntersecting){

entry.target.classList.add("show");

}

});

});

document.querySelectorAll("section").forEach(section=>{

observer.observe(section);

});

// Hero Slider

const slides = document.querySelectorAll(".slide");

let currentSlide = 0;

function showSlide(){

slides.forEach(slide=>{

slide.classList.remove("active");

});

currentSlide++;

if(currentSlide >= slides.length){

currentSlide = 0;

}

slides[currentSlide].classList.add("active");

}

setInterval(showSlide,5000);
