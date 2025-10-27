const togglePwD = document.getElementById("togglePwd")
const toggleRpwd = document.getElementById("toggleRpwd")
const pwd = document.getElementById("password")
const Rpwd = document.getElementById("repeatPassword")

if(togglePwD && pwd) {
    const setPwdVisible = (visible) => {
        const type = visible ? "text" : "password";
        pwd.setAttribute("type", type)
        togglePwD.innerHTML = `<i class="bi ${visible ? "bi-eye-slash" : "bi-eye"}"></i>`;
        togglePwD.setAttribute("aria-label", visible ? "Hide password" : "Show password");
        togglePwD.setAttribute("aria-pressed", String(visible));
    }
    togglePwD.addEventListener("click", () => {
        const isHidden = pwd.getAttribute("type") === "password" 
        setPwdVisible(isHidden)
    })
    setPwdVisible(false);
}


if(toggleRpwd && Rpwd) {
    const setPwdVisible = (visible) => {
        const type = visible ? "text" : "password";
        Rpwd.setAttribute("type", type)
        toggleRpwd.innerHTML = `<i class="bi ${visible ? "bi-eye-slash" : "bi-eye"}"></i>`;
        toggleRpwd.setAttribute("aria-label", visible ? "Hide password" : "Show password");
        toggleRpwd.setAttribute("aria-pressed", String(visible));
    }
    toggleRpwd.addEventListener("click", () => {
        const isHidden = Rpwd.getAttribute("type") === "password" 
        setPwdVisible(isHidden)
    })
    setPwdVisible(false);
}