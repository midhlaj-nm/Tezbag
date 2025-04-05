const loadHomepage = async (req,res)=>{
    try{
        return res.render('homepage')
    } catch (err){
        console.log('Something Happened', err)
        res.status(500).send('Server Error')
    }
}

const login_user = async (req,res)=>{
    try{
        return res.render('login_user')
    } catch (err){
        console.log('Something Happened', err)
        res.status(500).send('Server Error')
    }
}

const forgetPass = async (req,res)=>{
    try{
        return res.render('forgetpass')
    } catch (err){
        console.log('Something Happened', err)
        res.status(500).send('Server Error')
    }
}

const resetPass = async (req,res)=>{
    try{
        return res.render('resetPass')
    } catch (err){
        console.log('Something Happened', err)
        res.status(500).send('Server Error')
    }
}

const createAcc = async (req,res)=>{
    try{
        return res.render('createAccount')
    } catch (err){
        console.log('Something Happened', err)
        res.status(500).send('Server Error')
    }
}

const otpVerify = async (req,res)=>{
    try{
        return res.render('otppage')
    } catch (err){
        console.log('Something Happened', err)
        res.status(500).send('Server Error')
    }
}

const shop = async (req,res)=>{
    try{
        return res.render('shop')
    } catch (err){
        console.log('Something Happened', err)
        res.status(500).send('Server Error')
    }
}

const prdctDescription = async (req,res)=>{
    try{
        return res.render('products')
    } catch (err){
        console.log('Something Happened', err)
        res.status(500).send('Server Error')
    }
}

module.exports = {loadHomepage, login_user, forgetPass, resetPass, createAcc, otpVerify, shop, prdctDescription}