// Mobile Menu

const menuToggle = document.getElementById("menu-toggle");
const navMenu = document.getElementById("nav-menu");

menuToggle.addEventListener("click", () => {

    navMenu.classList.toggle("active");

});
// Shrink Header

window.addEventListener("scroll", function(){

const header = document.querySelector("header");

if(window.scrollY > 100){

header.classList.add("scrolled");

}else{

header.classList.remove("scrolled");

}

});
