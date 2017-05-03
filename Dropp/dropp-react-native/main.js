import Expo from 'expo';
import React from 'react';
import {
    Button,
    View,
    AppRegistry,
    Text,
    TextInput,
    Keyboard,
    StyleSheet,
    FlatList,
    TouchableHighlight,
    Image,
    Modal,
} from 'react-native';

import { TabNavigator, StackNavigator } from 'react-navigation';
import { MakeTextDroppScreen } from './MakeTextDroppScreen';
import { MakeDroppScreen } from './MakeDroppScreen';
import { MakePicDroppScreen} from './MakePicDroppScreen';
import { LoginScreen } from './LoginScreen';
import { CreateAccountScreen } from './CreateAccountScreen';
import { Constants, Location, Permissions } from 'expo';

class FeedScreen extends React.Component {
constructor(props){
    super(props);
    this.state = {
            text: '',
            errorMessage: null,
            sendingMessage: false,
            dropps: null,
            modalVisible: false,
            //modal data
    };
    this._getDropps();
}
    
    render() {
        const { navigate } = this.props.navigation;
        var modalBackgroundStyle = { backgroundColor: this.state.transparent ? 'rgba(0, 0, 0, 0.5)' : '#f5fcff', };
        var innerContainerTransparentStyle = this.state.transparent ? {backgroundColor: '#fff', padding: 20}: null;
        var activeButtonStyle = { backgroundColor: '#ddd' };
        return (
            <View>
                <Modal 
                    animationType = 'fade' 
                    transparent = {true} 
                    visible={this.state.modalVisible} 
                    supportedOrientations = {["portrait"]} 
                    onRequestClose={() => this._setModalVisible(false)}>
                    <View style={[styles.modalContainer, modalBackgroundStyle]}>
                        <View style={[styles.modalInnerContainer, innerContainerTransparentStyle]}>
                            <Text>TESTSTSTSTSTSTETADFADASDASDASDASDA</Text>
                            <Button 
                                onPress={this._setModalVisible.bind(this, false)} 
                                style={styles.modalButton} 
                                title = "close"/>
                        </View>
                    </View>
                </Modal>
                <FlatList
                    data={this.state.dropps}
                    renderItem={this._renderItem}
                    onRefresh = {this._onRefresh}
                    refreshing = {false}
                />
            </View>
        );
    }

    _renderItem = ({item}) => (
    <TouchableHighlight noDefaultStyles={true} onPress={() => this._onPress(item)} underlayColor ={"lightsalmon"} activeOpacity = {10}>
        <View style = {styles.row}>
            <View style = {styles.textcontainer}>
                <Text>{item.text}</Text>
            </View>
            <View style = {styles.photocontainer}>
                {item.media && <Image source = {{uri: item.media}} style ={styles.photo}/>}
            </View>
        </View>
    </TouchableHighlight>
    );

    _onPress = (item) => {
        console.log("Pressed");
        //set the modal data here with item
        this._setModalVisible(true);
    };

    _setModalVisible = (visible) => {
        this.setState({modalVisible: visible});
    };

    _onRefresh = () => {this._getDropps();}

    _getDropps = async() =>{
        console.log("entered getdropss");
        let{status} = await Permissions.askAsync(Permissions.LOCATION);
        if(status !== 'granted'){
            this.state({
                errorMessage: 'Permission to access location was denied',
            });
        } 

        let locData = await Location.getCurrentPositionAsync({enableHighAccuracy: true});
        //let curLocation = locData.coords.latitude + "," + locData.coords.longitude;
        let curLocation = "33.7786396,-118.1139802";
        let curTime = locData.timestamp;

        var param = {
            location: curLocation,
            maxDistance: 1000,
        };

        var formData = [];
        for(var i in param){
            var encodeKey = encodeURIComponent(i);
            var encodeValue = encodeURIComponent(param[i]);
            formData.push(encodeKey + "=" + encodeValue);
        }
        formData = formData.join("&");

        var feedRequest = new Request('https://dropps.me/location/dropps', {
            method: 'POST',
            headers: new Headers( {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImpvZWwiLCJkZXRhaWxzIjp7ImVtYWlsIjoiam9lbEBmYWtlbWFpbC5jb20ifSwiaWF0IjoxNDkzNzc5MjIwLCJleHAiOjE0OTYzNzEyMjB9.6PFDs9PuZQQMO5o2qjNShlQ4sSj5dwodz4ar8vWKzhQ',
            }),
            body: formData,
        });
        var feedList = [];
        //parsing the json object into the array
        fetch(feedRequest).then((drp) => {
            drp.json().then((droppJSON) =>{
                var dropList = droppJSON.dropps;
                for(var d in dropList) {
                    var post = dropList[d];
                    feedList.push(post);
                    console.log(feedList);
                }
                this.setState({dropps: feedList});
            });
        });
    }
}
const MainScreenNavigator = TabNavigator({
    Feed: { screen: FeedScreen },
    Dropp: { screen: MakeDroppScreen },
    }, {
        tabBarOptions: {
            style:{
                backgroundColor: '#ffa07a',
                opacity: 100,
            },
        },
    });

const App = StackNavigator({
    Login: { screen: LoginScreen },
    CreateAccount: { screen: CreateAccountScreen },
    Home: { screen: MainScreenNavigator },
    TextDropp: { screen: MakeTextDroppScreen },
    PicDropp: {screen: MakePicDroppScreen },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    borderBottomWidth: 0.5,
    padding: 25,
    borderBottomColor: '#000000'
  },
  dropptext:{
      flex: 2,
      flexDirection: 'row',
      padding: 10
  },
  textcontainer: {
      flex: 2
  },
  photocontainer:{
      flex: 1,
      justifyContent: 'center',
      alignItems:'center',
      width: 120,
      height: 120,
  },
  photo: {
      width: 120,
      height: 120,
  },
  modalButton: {
    marginTop: 10,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalInnerContainer: {
    borderRadius: 10,
    alignItems: 'center',
  },
});

Expo.registerRootComponent(App);
