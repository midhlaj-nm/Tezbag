const loadLogin = async (req,res)=>{
    try{
        return res.render('login-admin')
    } catch (err){
        console.log('Something Happened', err)
        res.status(500).send('Server Error')
    }
}

module.exports = {loadLogin}