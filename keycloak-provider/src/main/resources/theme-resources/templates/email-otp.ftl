<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=true; section>
    <#if section = "header">
        Enter email code
    <#elseif section = "form">
        <form id="kc-otp-login-form" action="${url.loginAction}" method="post">
            <div class="${properties.kcFormGroupClass!}">
                <label for="otp" class="${properties.kcLabelClass!}">6-digit code sent to your email</label>
                <input id="otp"
                       name="otp"
                       type="text"
                       autocomplete="one-time-code"
                       inputmode="numeric"
                       pattern="[0-9]{6}"
                       maxlength="6"
                       autofocus
                       class="${properties.kcInputClass!}"/>
            </div>
            <div class="${properties.kcFormGroupClass!}">
                <input class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
                       name="login"
                       type="submit"
                       value="Verify"/>
            </div>
        </form>
    </#if>
</@layout.registrationLayout>
